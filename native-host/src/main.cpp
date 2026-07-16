#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <wrl.h>
#include <wrl/wrappers/corewrappers.h>
#include <tlhelp32.h>

#include <cstdio>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cwctype>
#include <future>
#include <mutex>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {

// Globale Logging-Funktion. Ueber ein globales Flag kann der gesamte
// printf-Output an- bzw. ausgeschaltet werden. Im Default laeuft der
// Injector ohne sichtbares Fenster und ohne Logging; ueber den
// Startparameter "-show" wird beides eingeschaltet.
bool g_loggingEnabled = false;

void logLine(const char* fmt, ...) {
    if (!g_loggingEnabled) {
        return;
    }
    va_list args;
    va_start(args, fmt);
    vprintf(fmt, args);
    va_end(args);
    fflush(stdout);
}

constexpr std::uint32_t CLIPBOARD_READY_DELAY_MS = 15;
constexpr std::uint32_t CLIPBOARD_RESTORE_DELAY_MS = 30;
constexpr uint16_t WS_PORT = 58765;
constexpr char WS_MAGIC_GUID[] = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// ─── SHA1 (RFC 3174) ────────────────────────────────────────────

struct Sha1Context {
    uint32_t state[5];
    uint64_t count;
    uint8_t buffer[64];
};

void sha1Init(Sha1Context* ctx) {
    ctx->state[0] = 0x67452301;
    ctx->state[1] = 0xEFCDAB89;
    ctx->state[2] = 0x98BADCFE;
    ctx->state[3] = 0x10325476;
    ctx->state[4] = 0xC3D2E1F0;
    ctx->count = 0;
}

static uint32_t sha1Rotl(uint32_t v, int n) {
    return (v << n) | (v >> (32 - n));
}

static void sha1ProcessBlock(uint32_t state[5], const uint8_t block[64]) {
    uint32_t w[80];
    for (int i = 0; i < 16; ++i)
        w[i] = ((uint32_t)block[i*4] << 24) | ((uint32_t)block[i*4+1] << 16)
             | ((uint32_t)block[i*4+2] <<  8) |  (uint32_t)block[i*4+3];
    for (int i = 16; i < 80; ++i) {
        uint32_t t = w[i-3] ^ w[i-8] ^ w[i-14] ^ w[i-16];
        w[i] = sha1Rotl(t, 1);
    }

    uint32_t a = state[0], b = state[1], c = state[2], d = state[3], e = state[4];

    for (int i = 0; i < 80; ++i) {
        uint32_t f, k;
        if (i < 20)      { f = (b & c) | (~b & d);            k = 0x5A827999; }
        else if (i < 40) { f = b ^ c ^ d;                     k = 0x6ED9EBA1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d);   k = 0x8F1BBCDC; }
        else             { f = b ^ c ^ d;                     k = 0xCA62C1D6; }

        uint32_t temp = sha1Rotl(a, 5) + f + e + k + w[i];
        e = d; d = c; c = sha1Rotl(b, 30); b = a; a = temp;
    }

    state[0] += a; state[1] += b; state[2] += c; state[3] += d; state[4] += e;
}

void sha1Update(Sha1Context* ctx, const uint8_t* data, size_t len) {
    size_t bufferIdx = (size_t)(ctx->count % 64);
    ctx->count += (uint64_t)len;

    size_t gap = 64 - bufferIdx;
    size_t offset = 0;

    if (len >= gap) {
        memcpy(ctx->buffer + bufferIdx, data, gap);
        sha1ProcessBlock(ctx->state, ctx->buffer);
        offset = gap;
        while (offset + 63 < len) {
            sha1ProcessBlock(ctx->state, data + offset);
            offset += 64;
        }
        bufferIdx = 0;
    }

    memcpy(ctx->buffer + bufferIdx, data + offset, len - offset);
}

void sha1Final(Sha1Context* ctx, uint8_t digest[20]) {
    uint8_t bits[8];
    uint64_t totalBits = ctx->count * 8;
    for (int i = 0; i < 8; ++i)
        bits[i] = (uint8_t)(totalBits >> (56 - i * 8));

    size_t bufferIdx = (size_t)(ctx->count % 64);
    ctx->buffer[bufferIdx++] = 0x80;

    if (bufferIdx > 56) {
        memset(ctx->buffer + bufferIdx, 0, 64 - bufferIdx);
        sha1ProcessBlock(ctx->state, ctx->buffer);
        bufferIdx = 0;
    }

    memset(ctx->buffer + bufferIdx, 0, 56 - bufferIdx);
    memcpy(ctx->buffer + 56, bits, 8);
    sha1ProcessBlock(ctx->state, ctx->buffer);

    for (int i = 0; i < 20; ++i)
        digest[i] = (uint8_t)(ctx->state[i >> 2] >> (24 - (i & 3) * 8));
}

std::string sha1(const std::string& input) {
    Sha1Context ctx;
    sha1Init(&ctx);
    sha1Update(&ctx, reinterpret_cast<const uint8_t*>(input.data()), input.size());
    uint8_t digest[20];
    sha1Final(&ctx, digest);
    return std::string(reinterpret_cast<char*>(digest), 20);
}

// ─── Base64 ─────────────────────────────────────────────────────

std::string base64Encode(const std::string& input) {
    static const char kChars[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((input.size() + 2) / 3) * 4);

    for (size_t i = 0; i < input.size(); i += 3) {
        uint32_t n = (static_cast<uint8_t>(input[i]) << 16);
        if (i + 1 < input.size()) n |= (static_cast<uint8_t>(input[i+1]) << 8);
        if (i + 2 < input.size()) n |=  static_cast<uint8_t>(input[i+2]);

        out.push_back(kChars[(n >> 18) & 63]);
        out.push_back(kChars[(n >> 12) & 63]);
        out.push_back((i + 1 < input.size()) ? kChars[(n >> 6) & 63] : '=');
        out.push_back((i + 2 < input.size()) ? kChars[ n       & 63] : '=');
    }
    return out;
}

// ─── Data structures ────────────────────────────────────────────

struct InjectPayload {
    std::wstring text;
    std::wstring mode = L"clipboard";
    bool restorePreviousWindow = true;
    std::uint32_t delayMs = 120;
    std::uint32_t charDelayMs = 0;
};

struct NativeRequest {
    std::wstring type;
    std::wstring requestId;
    InjectPayload payload;
};

struct HotkeyBinding {
    int id;
    UINT virtualKey;
    UINT modifiers; // 0 oder MOD_SHIFT
    const char* action;
    const char* key;
};

struct HotkeyListener {
    std::thread thread;
    std::atomic<bool> running{false};
    DWORD threadId = 0;
};

// ─── Global state ───────────────────────────────────────────────

std::mutex g_clientsMutex;
std::set<SOCKET> g_wsClients;
std::atomic<bool> g_serverRunning{false};
std::mutex g_injectMutex;
std::mutex g_notificationMutex;
std::atomic<bool> g_recordingState{false};

// ─── HID Raw Input für Diktiermikrofone ─────────────────────────
// Ersetzt die Chrome-WebHID-Permission: Der Native Host liest die
// HID-Input-Reports direkt via Windows Raw-Input-API und sendet
// Record-Events per WebSocket an die App. Kein Browser-Dialog nötig.

constexpr uint16_t GRUNDIG_SONICMIC_VENDOR_ID = 0x15D8;
constexpr uint16_t GRUNDIG_SONICMIC_PRODUCT_ID = 0x0025;
constexpr uint16_t PHILIPS_SPEECHMIKE_VENDOR_ID = 0x0911;
constexpr uint16_t PHILIPS_SPEECHMIKE_III_PRODUCT_ID = 0x0C1C;
constexpr uint16_t NORDIC_DICTATION_VENDOR_ID = 0x1915;
constexpr uint16_t NORDIC_DICTATION_PRODUCT_ID = 0x1025;

// HID-Diagnose-Logging: Wird als hid-diagnostic per WebSocket an den Browser
// gesendet, damit Fehler in der Browser-Konsole sichtbar sind.
// logLine() ist ohne -show stumm; hidDiagnostic() ist immer aktiv.
bool g_hidDiagnosticEnabled = true;

// Forward-Declaration fuer broadcastToClients / sendWsFrame
void broadcastToClients(const std::string& message);
bool sendWsFrame(SOCKET client, uint8_t opcode, const std::string& payload);

void hidDiagnostic(const char* fmt, ...) {
    if (!g_hidDiagnosticEnabled) return;
    char buf[1024];
    va_list args;
    va_start(args, fmt);
    const int n = vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);

    // Immer auf stdout (sichtbar nur mit -show / DebugView mit AllocConsole)
    printf("[HID-Diag] %s\n", buf);
    fflush(stdout);

    // Zusaetzlich als WebSocket-Nachricht an alle Clients broadcasten
    if (n > 0 && static_cast<size_t>(n) < sizeof(buf)) {
        std::string msg = "{\"type\":\"hid-diagnostic\",\"message\":\"";
        // JSON-Escaping (vereinfacht: nur \" und \\)
        for (int i = 0; i < n; ++i) {
            if (buf[i] == '"') msg += "\\\"";
            else if (buf[i] == '\\') msg += "\\\\";
            else if (buf[i] == '\n') msg += "\\n";
            else msg += buf[i];
        }
        msg += "\"}";
        broadcastToClients(msg);
    }
}

// Helfer: Raw-HID-Bytes als Hex-String formatieren
std::string hexDump(const uint8_t* data, size_t size) {
    std::string out;
    out.reserve(size * 3);
    for (size_t i = 0; i < size; ++i) {
        static const char hex[] = "0123456789ABCDEF";
        out += hex[data[i] >> 4];
        out += hex[data[i] & 0xF];
        if (i + 1 < size) out += ' ';
    }
    return out;
}

// Alle angeschlossenen Raw-Input-Geraete auflisten – zur Diagnose,
// ob Windows das Mikrofon ueberhaupt erkennt.
void enumerateAllRawInputDevices() {
    UINT count = 0;
    if (GetRawInputDeviceList(nullptr, &count, sizeof(RAWINPUTDEVICELIST)) != 0) {
        hidDiagnostic("GetRawInputDeviceList: Fehler beim Ermitteln der Geraeteanzahl");
        return;
    }
    hidDiagnostic("GetRawInputDeviceList: %u Raw-Input-Geraete im System", count);

    if (count == 0) return;

    std::vector<RAWINPUTDEVICELIST> list(count);
    if (GetRawInputDeviceList(list.data(), &count, sizeof(RAWINPUTDEVICELIST)) == (UINT)-1) {
        hidDiagnostic("GetRawInputDeviceList: Fehler beim Abrufen der Geraeteliste");
        return;
    }

    for (UINT i = 0; i < count; ++i) {
        RID_DEVICE_INFO info{};
        info.cbSize = sizeof(info);
        UINT infoSize = sizeof(info);
        if (GetRawInputDeviceInfoW(list[i].hDevice, RIDI_DEVICEINFO, &info, &infoSize) != infoSize) {
            hidDiagnostic("  [%u] Typ=%lu – GetRawInputDeviceInfoW fehlgeschlagen",
                         i, list[i].dwType);
            continue;
        }

        UINT nameLen = 0;
        GetRawInputDeviceInfoW(list[i].hDevice, RIDI_DEVICENAME, nullptr, &nameLen);
        std::wstring name;
        if (nameLen > 0) {
            std::vector<wchar_t> buf(nameLen);
            if (GetRawInputDeviceInfoW(list[i].hDevice, RIDI_DEVICENAME,
                                       buf.data(), &nameLen) > 0) {
                name = buf.data();
            }
        }

        if (info.dwType == RIM_TYPEKEYBOARD) {
            hidDiagnostic("  [%u] TASTATUR hDevice=0x%p name=\"%ls\"",
                         i, list[i].hDevice, name.c_str());
        } else if (info.dwType == RIM_TYPEMOUSE) {
            hidDiagnostic("  [%u] MAUS hDevice=0x%p name=\"%ls\"",
                         i, list[i].hDevice, name.c_str());
        } else if (info.dwType == RIM_TYPEHID) {
            const bool supported = (info.hid.dwVendorId == 0x15D8 && info.hid.dwProductId == 0x0025) ||
                                   (info.hid.dwVendorId == 0x0911 && info.hid.dwProductId == 0x0C1C) ||
                                   (info.hid.dwVendorId == 0x1915 && info.hid.dwProductId == 0x1025);
            hidDiagnostic("  [%u] HID VID=0x%04X PID=0x%04X UsagePage=0x%04X Usage=0x%04X %s name=\"%ls\"",
                         i,
                         info.hid.dwVendorId,
                         info.hid.dwProductId,
                         info.hid.usUsagePage,
                         info.hid.usUsage,
                         supported ? "<- UNTERSTUETZT" : "",
                         name.c_str());
        } else {
            hidDiagnostic("  [%u] UNBEKANNT Typ=%lu name=\"%ls\"",
                         i, list[i].dwType, name.c_str());
        }
    }
}

struct HidDeviceState {
    std::wstring deviceName;
    uint16_t vendorId = 0;
    uint16_t productId = 0;
    bool recordPressed = false;
};

std::vector<HidDeviceState> g_hidDevices;
std::mutex g_hidMutex;
bool g_hidRawInputRegistered = false;

std::wstring g_hidLastDeviceName;
std::mutex g_hidStatusMutex;

// ─── Target-Window-Tracking ────────────────────────────────────
// Merkt sich das Fenster, in das zuletzt erfolgreich Text injected wurde.
// Bei der nächsten Injection wird versucht, genau dieses Fenster wieder in
// den Vordergrund zu holen – nicht nur das "vorherige" per Alt+Tab.
// Zusätzlich können Frontend-seitig Fenster-Titel/Class-Patterns konfiguriert
// werden, um das Ziel-Fenster auch nach einem Neustart wiederzufinden.
HWND g_targetWindow = nullptr;
std::wstring g_targetWindowTitlePattern;
std::wstring g_targetWindowClassName;
std::mutex g_targetWindowMutex;

// Callback für EnumWindows: sucht ein Fenster mit bestimmtem Titel-Pattern oder Klassenname.
struct FindTargetWindowContext {
    std::wstring titlePattern;
    std::wstring className;
    HWND foundHwnd = nullptr;
};

BOOL CALLBACK enumFindTargetWindow(HWND hwnd, LPARAM lParam) {
    auto* ctx = reinterpret_cast<FindTargetWindowContext*>(lParam);
    if (!IsWindowVisible(hwnd)) return TRUE;

    // Klassenname prüfen, falls gesetzt
    if (!ctx->className.empty()) {
        wchar_t classBuf[256] = {};
        GetClassNameW(hwnd, classBuf, static_cast<int>(std::size(classBuf)));
        // Case-insensitive Vergleich (portable, kein _wcsicmp nötig)
        bool classMatch = true;
        if (wcslen(classBuf) != ctx->className.length()) {
            classMatch = false;
        } else {
            for (size_t i = 0; i < ctx->className.length(); ++i) {
                if (towlower(classBuf[i]) != towlower(ctx->className[i])) {
                    classMatch = false;
                    break;
                }
            }
        }
        if (!classMatch) return TRUE;
    }

    // Titel-Pattern prüfen, falls gesetzt
    if (!ctx->titlePattern.empty()) {
        wchar_t titleBuf[512] = {};
        GetWindowTextW(hwnd, titleBuf, static_cast<int>(std::size(titleBuf)));
        if (wcslen(titleBuf) == 0) return TRUE;
        std::wstring title(titleBuf);
        // Case-insensitive Substring-Suche
        auto it = std::search(
            title.begin(), title.end(),
            ctx->titlePattern.begin(), ctx->titlePattern.end(),
            [](wchar_t a, wchar_t b) { return towlower(a) == towlower(b); }
        );
        if (it == title.end()) return TRUE;
    }

    // Gefunden!
    ctx->foundHwnd = hwnd;
    return FALSE; // Enumeration abbrechen
}

HWND findTargetWindowByPattern() {
    FindTargetWindowContext ctx;
    {
        std::lock_guard<std::mutex> lock(g_targetWindowMutex);
        ctx.titlePattern = g_targetWindowTitlePattern;
        ctx.className = g_targetWindowClassName;
    }
    if (ctx.titlePattern.empty() && ctx.className.empty()) return nullptr;

    EnumWindows(enumFindTargetWindow, reinterpret_cast<LPARAM>(&ctx));
    return ctx.foundHwnd;
}

// Deduplizierung von doppelten Text-Injection-Aufrufen.
// Der Client wiederholt einen Request bei Timeout – der erste Request
// wurde dann aber vom Host bereits verarbeitet. Dieselbe Text-Injection
// darf nicht ein zweites Mal ausgeführt werden.
struct InjectDedupEntry {
    std::wstring text;
    std::chrono::steady_clock::time_point timestamp;
};
InjectDedupEntry g_lastInjectDedup;
std::mutex g_injectDedupMutex;
constexpr auto INJECT_DEDUP_WINDOW = std::chrono::seconds(8);

constexpr UINT SCHREIBDIENST_TRAY_ICON_ID = 1;
bool g_trayIconRegistered = false;

// Hidden message-only window for SendInput delegation.
// SendInput(KEYEVENTF_UNICODE) requires the calling thread to have
// a message queue. A GUI-subsystem process without a window has none.
// We create a hidden window on a dedicated thread so all SendInput
// calls execute on a thread that owns a message queue.
constexpr UINT WM_APP_DO_SENDINPUT = WM_APP + 1;
constexpr UINT WM_APP_UPDATE_RECORDING_OVERLAY = WM_APP + 2;

struct SendInputJob {
    std::vector<INPUT> inputs;
    std::promise<UINT> result;
};

HWND g_hiddenWnd = nullptr;
HANDLE g_hiddenWndReady = nullptr;
DWORD g_hiddenWndThreadId = 0;
HWND g_recordingOverlayWnd = nullptr;
std::atomic<bool> g_frontendTargetMode{false};

LRESULT CALLBACK RecordingOverlayWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (msg == WM_PAINT) {
        PAINTSTRUCT ps{};
        HDC hdc = BeginPaint(hwnd, &ps);

        RECT clientRect{};
        GetClientRect(hwnd, &clientRect);

        HBRUSH background = CreateSolidBrush(RGB(190, 0, 0));
        FillRect(hdc, &clientRect, background);
        DeleteObject(background);

        HPEN borderPen = CreatePen(PS_SOLID, 2, RGB(255, 255, 255));
        HGDIOBJ oldPen = SelectObject(hdc, borderPen);
        HGDIOBJ oldBrush = SelectObject(hdc, GetStockObject(NULL_BRUSH));
        Rectangle(hdc, clientRect.left, clientRect.top, clientRect.right, clientRect.bottom);
        SelectObject(hdc, oldBrush);
        SelectObject(hdc, oldPen);
        DeleteObject(borderPen);

        SetBkMode(hdc, TRANSPARENT);
        SetTextColor(hdc, RGB(255, 255, 255));

        HFONT font = CreateFontW(
            30, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE,
            DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
            CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI"
        );
        HGDIOBJ oldFont = SelectObject(hdc, font);

        RECT textRect = clientRect;
        DrawTextW(hdc, L"REC - AUFNAHME AKTIV", -1, &textRect, DT_CENTER | DT_VCENTER | DT_SINGLELINE);

        SelectObject(hdc, oldFont);
        DeleteObject(font);
        EndPaint(hwnd, &ps);
        return 0;
    }

    if (msg == WM_NCHITTEST) {
        return HTTRANSPARENT;
    }

    return DefWindowProc(hwnd, msg, wParam, lParam);
}

HWND ensureRecordingOverlayWindow() {
    if (g_recordingOverlayWnd != nullptr) {
        return g_recordingOverlayWnd;
    }

    static bool classRegistered = false;
    if (!classRegistered) {
        WNDCLASSEXW wc{};
        wc.cbSize = sizeof(wc);
        wc.lpfnWndProc = RecordingOverlayWndProc;
        wc.hInstance = GetModuleHandle(nullptr);
        wc.lpszClassName = L"SchreibdienstRecordingOverlay";
        wc.hCursor = LoadCursor(nullptr, IDC_ARROW);

        if (!RegisterClassExW(&wc)) {
            return nullptr;
        }

        classRegistered = true;
    }

    constexpr int overlayWidth = 430;
    constexpr int overlayHeight = 74;
    constexpr int marginTop = 24;
    constexpr int marginRight = 24;

    const int screenWidth = GetSystemMetrics(SM_CXSCREEN);
    const int x = std::max(0, screenWidth - overlayWidth - marginRight);
    const int y = marginTop;

    g_recordingOverlayWnd = CreateWindowExW(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_LAYERED | WS_EX_NOACTIVATE,
        L"SchreibdienstRecordingOverlay",
        L"",
        WS_POPUP,
        x,
        y,
        overlayWidth,
        overlayHeight,
        nullptr,
        nullptr,
        GetModuleHandle(nullptr),
        nullptr
    );

    if (g_recordingOverlayWnd == nullptr) {
        return nullptr;
    }

    SetLayeredWindowAttributes(g_recordingOverlayWnd, 0, 245, LWA_ALPHA);
    return g_recordingOverlayWnd;
}

void updateRecordingOverlayVisibility(bool visible) {
    HWND overlay = ensureRecordingOverlayWindow();
    if (overlay == nullptr) {
        return;
    }

    if (visible) {
        SetWindowPos(
            overlay,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE
        );
        InvalidateRect(overlay, nullptr, TRUE);
        UpdateWindow(overlay);
        return;
    }

    ShowWindow(overlay, SW_HIDE);
}

void postRecordingOverlayUpdate(bool visible) {
    if (g_hiddenWnd == nullptr) {
        return;
    }

    PostMessage(g_hiddenWnd, WM_APP_UPDATE_RECORDING_OVERLAY, visible ? 1 : 0, 0);
}

std::wstring getExecutablePath() {
    wchar_t path[MAX_PATH] = {};
    DWORD length = GetModuleFileNameW(nullptr, path, static_cast<DWORD>(std::size(path)));
    if (length == 0 || length >= std::size(path)) {
        return L"";
    }
    return std::wstring(path, length);
}

std::wstring getExecutableDirectory() {
    std::wstring executablePath = getExecutablePath();
    const size_t separator = executablePath.find_last_of(L"\\/");
    if (separator == std::wstring::npos) {
        return L"";
    }
    return executablePath.substr(0, separator);
}

// ─── Injector-Konfiguration (injector-config.json) ─────────────

std::vector<std::wstring> g_blockedProcesses;
std::once_flag g_configLoadedFlag;

std::wstring getConfigDirectory() {
    wchar_t path[MAX_PATH] = {};
    if (SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, path) != S_OK) {
        return L"";
    }
    std::wstring dir = std::wstring(path) + L"\\Schreibdienst";
    CreateDirectoryW(dir.c_str(), nullptr);
    return dir;
}

std::wstring getConfigFilePath() {
    return getConfigDirectory() + L"\\injector-config.json";
}

std::wstring getProcessNameFromPid(DWORD pid) {
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return L"";

    PROCESSENTRY32W pe;
    pe.dwSize = sizeof(pe);

    if (Process32FirstW(snapshot, &pe)) {
        do {
            if (pe.th32ProcessID == pid) {
                std::wstring name = pe.szExeFile;
                for (auto& c : name) c = towlower(c);
                CloseHandle(snapshot);
                return name;
            }
        } while (Process32NextW(snapshot, &pe));
    }

    CloseHandle(snapshot);
    return L"";
}

std::wstring getWindowProcessName(HWND hwnd) {
    if (hwnd == nullptr) return L"";
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (pid == 0) return L"";
    return getProcessNameFromPid(pid);
}

void ensureDefaultConfigFile() {
    const std::wstring configPath = getConfigFilePath();
    if (configPath.empty()) return;

    if (GetFileAttributesW(configPath.c_str()) != INVALID_FILE_ATTRIBUTES) {
        return;
    }

    HANDLE hFile = CreateFileW(configPath.c_str(), GENERIC_WRITE, 0, nullptr,
                               CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (hFile == INVALID_HANDLE_VALUE) return;

    const char* defaultConfig =
        "{\n"
        "  \"clipboardBlockedProcesses\": [\"ccpnet.exe\"]\n"
        "}\n";

    DWORD written = 0;
    WriteFile(hFile, defaultConfig, static_cast<DWORD>(strlen(defaultConfig)), &written, nullptr);
    CloseHandle(hFile);

    logLine("[CONFIG] Default config created: %ls\n", configPath.c_str());
    fflush(stdout);
}

void loadInjectorConfig() {
    g_blockedProcesses.clear();

    const std::wstring configPath = getConfigFilePath();
    if (configPath.empty()) return;

    HANDLE hFile = CreateFileW(configPath.c_str(), GENERIC_READ, FILE_SHARE_READ,
                               nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (hFile == INVALID_HANDLE_VALUE) return;

    DWORD fileSize = GetFileSize(hFile, nullptr);
    if (fileSize == 0 || fileSize > 65536) {
        CloseHandle(hFile);
        return;
    }

    std::vector<char> buf(fileSize + 1, 0);
    DWORD read = 0;
    if (!ReadFile(hFile, buf.data(), fileSize, &read, nullptr)) {
        CloseHandle(hFile);
        return;
    }
    CloseHandle(hFile);

    std::string content(buf.data());

    // "clipboardBlockedProcesses"-Array per einfacher String-Suche parsen
    auto keyPos = content.find("\"clipboardBlockedProcesses\"");
    if (keyPos == std::string::npos) return;

    auto arrayStart = content.find('[', keyPos);
    if (arrayStart == std::string::npos) return;

    auto arrayEnd = content.find(']', arrayStart);
    if (arrayEnd == std::string::npos) return;

    std::string arrayContent = content.substr(arrayStart + 1, arrayEnd - arrayStart - 1);

    size_t pos = 0;
    while ((pos = arrayContent.find('"', pos)) != std::string::npos) {
        auto endQuote = arrayContent.find('"', pos + 1);
        if (endQuote == std::string::npos) break;

        std::string name = arrayContent.substr(pos + 1, endQuote - pos - 1);
        if (!name.empty()) {
            std::wstring wname;
            for (char c : name) wname.push_back(towlower(static_cast<unsigned char>(c)));
            g_blockedProcesses.push_back(wname);
        }
        pos = endQuote + 1;
    }

    logLine("[CONFIG] %zu clipboard-blocked process(es) from %ls\n",
            g_blockedProcesses.size(), configPath.c_str());
    for (const auto& p : g_blockedProcesses) {
        logLine("[CONFIG]   - %ls\n", p.c_str());
    }
    fflush(stdout);
}

void initInjectorConfig() {
    ensureDefaultConfigFile();
    loadInjectorConfig();
}

bool isClipboardBlockedForTarget(HWND targetWindow) {
    if (targetWindow == nullptr || g_blockedProcesses.empty()) return false;

    std::wstring processName = getWindowProcessName(targetWindow);
    if (processName.empty()) return false;

    for (const auto& blocked : g_blockedProcesses) {
        if (processName == blocked) {
            logLine("[INJECT] Target process \"%ls\" is clipboard-blocked → use sendinput\n",
                    processName.c_str());
            fflush(stdout);
            return true;
        }
    }

    return false;
}

#ifndef __MINGW32__
bool showModernRecordingToast(bool /*active*/) {
    return false;
}
#else
bool showModernRecordingToast(bool /*active*/) {
    return false;
}
#endif

HICON getTrayStatusIcon(bool recordingActive) {
    return LoadIcon(nullptr, recordingActive ? IDI_ERROR : IDI_APPLICATION);
}

void updateTrayIconAppearanceLocked(bool recordingActive) {
    if (!g_trayIconRegistered || g_hiddenWnd == nullptr) {
        return;
    }

    NOTIFYICONDATAW nid{};
    nid.cbSize = sizeof(nid);
    nid.hWnd = g_hiddenWnd;
    nid.uID = SCHREIBDIENST_TRAY_ICON_ID;
    nid.uFlags = NIF_ICON | NIF_TIP;
    nid.hIcon = getTrayStatusIcon(recordingActive);

    if (recordingActive) {
        wcscpy_s(nid.szTip, L"Schreibdienst Injector - Aufnahme aktiv");
    } else {
        wcscpy_s(nid.szTip, L"Schreibdienst Injector");
    }

    Shell_NotifyIconW(NIM_MODIFY, &nid);
}

bool ensureTrayIconRegistered() {
    if (g_hiddenWnd == nullptr) {
        return false;
    }

    if (g_trayIconRegistered) {
        return true;
    }

    NOTIFYICONDATAW nid{};
    nid.cbSize = sizeof(nid);
    nid.hWnd = g_hiddenWnd;
    nid.uID = SCHREIBDIENST_TRAY_ICON_ID;
    nid.uFlags = NIF_ICON | NIF_TIP;
    nid.hIcon = getTrayStatusIcon(g_recordingState.load());
    wcscpy_s(nid.szTip, g_recordingState.load() ? L"Schreibdienst Injector - Aufnahme aktiv" : L"Schreibdienst Injector");

    if (!Shell_NotifyIconW(NIM_ADD, &nid)) {
        return false;
    }

    nid.uVersion = NOTIFYICON_VERSION_4;
    Shell_NotifyIconW(NIM_SETVERSION, &nid);
    g_trayIconRegistered = true;
    return true;
}

void removeTrayIcon() {
    std::lock_guard<std::mutex> lock(g_notificationMutex);
    if (!g_trayIconRegistered || g_hiddenWnd == nullptr) {
        return;
    }

    NOTIFYICONDATAW nid{};
    nid.cbSize = sizeof(nid);
    nid.hWnd = g_hiddenWnd;
    nid.uID = SCHREIBDIENST_TRAY_ICON_ID;
    Shell_NotifyIconW(NIM_DELETE, &nid);
    g_trayIconRegistered = false;
}

void showRecordingStatusNotification(bool active, const wchar_t* source) {
    std::lock_guard<std::mutex> lock(g_notificationMutex);

    if (!ensureTrayIconRegistered()) {
        return;
    }

    logLine("[NOTIFY] recording=%d source=%ls\n", active ? 1 : 0, source);
}

void setRecordingState(bool active, const wchar_t* source, bool notify) {
    const bool previous = g_recordingState.exchange(active);

    if (active) {
        postRecordingOverlayUpdate(notify);
    } else {
        postRecordingOverlayUpdate(false);
    }

    {
        std::lock_guard<std::mutex> lock(g_notificationMutex);
        if (ensureTrayIconRegistered()) {
            updateTrayIconAppearanceLocked(active);
        }
    }

    if (previous == active) {
        return;
    }

    if (notify) {
        showRecordingStatusNotification(active, source);
    }
}

// ─── HID Raw Input: Report Parsing ──────────────────────────────
// Direkter Zugriff auf die HID-Input-Reports von Grundig SonicMic
// und Philips SpeechMike III ohne Chrome-Sandbox.

bool isGrundigRecordPayload(const uint8_t* data, size_t size) {
    // Grundig SonicMic Record-Payload (Raw Input, inkl. Report-ID):
    //   Record gedrueckt:  01 01 00 00 00 00 00 40 02 00 ...
    //   Record losgelassen: 01 01 00 00 00 00 00 00 02 00 ...
    // Byte 0 = Report-ID (0x01)
    // Byte 1 = Header/Berichtstyp (0x01)
    // Byte 7 = 0x40 (gedrueckt) / 0x00 (losgelassen)
    // Alle anderen Bytes bleiben gleich.
    if (size < 8) return false;
    if (data[0] != 0x01) return false; // Report-ID
    return data[7] == 0x40;           // Record-Status (korrigiert von data[6])
}

bool isPhilipsSpeechMikeRecordPayload(const uint8_t* data, size_t size) {
    // Philips SpeechMike III auf UsagePage 0xFFA0:
    // Report-Format: [00] [Button] [00 00 00 00 00 00] [???] [Pressed]
    // Byte 0 = Report-ID (0x00)
    // Byte 1 = Button-Mask (0x80 = Record, 0x9E = Stop, etc.)
    // Byte 8 = unbekannt
    // Byte 9 = 0x01 = gedrueckt, 0x00 = losgelassen
    if (size < 10) return false;

    // Philips auf 0xFFA0: Byte 0=0x00, Byte 1=0x80 = Record
    if (data[0] == 0x00 && data[1] == 0x80) {
        // Byte 9 = 0x01 bedeutet gedrueckt
        return data[9] == 0x01;
    }

    // Altes Format (UsagePage 0xFFA1, ohne Report-ID):
    // 80 00 00 00 00 00 00 00 01
    return size >= 9 && data[0] == 0x80 && data[1] == 0x00
        && data[2] == 0x00 && data[3] == 0x00
        && data[4] == 0x00 && data[5] == 0x00
        && data[6] == 0x00 && data[7] == 0x00
        && data[8] == 0x01;
}

bool isGrundigDevice(uint16_t vendorId, uint16_t productId) {
    return vendorId == GRUNDIG_SONICMIC_VENDOR_ID && productId == GRUNDIG_SONICMIC_PRODUCT_ID;
}

bool isPhilipsSpeechMikeDevice(uint16_t vendorId, uint16_t productId) {
    return vendorId == PHILIPS_SPEECHMIKE_VENDOR_ID && productId == PHILIPS_SPEECHMIKE_III_PRODUCT_ID;
}

bool isNordicDictationDevice(uint16_t vendorId, uint16_t productId) {
    return vendorId == NORDIC_DICTATION_VENDOR_ID && productId == NORDIC_DICTATION_PRODUCT_ID;
}

bool isSupportedHidDevice(uint16_t vendorId, uint16_t productId) {
    return isGrundigDevice(vendorId, productId) || isPhilipsSpeechMikeDevice(vendorId, productId) || isNordicDictationDevice(vendorId, productId);
}

bool isNordicDictationRecordPayload(const uint8_t* data, size_t size) {
    // Consumer Control report: 16-bit little-endian usage value
    // Record-Taste gedrueckt = Usage 0x00CF (Bytes [0xCF, 0x00])
    // Der Report kann mit oder ohne Report-ID-Byte (0x02) kommen.

    // Ohne Report-ID (2 Bytes minimum)
    if (size >= 2) {
        uint16_t usage = data[0] | (static_cast<uint16_t>(data[1]) << 8);
        if (usage == 0x00CF) return true;
    }

    // Mit Report-ID (3 Bytes minimum, Report-ID = 0x02)
    if (size >= 3 && data[0] == 0x02) {
        uint16_t usage = data[1] | (static_cast<uint16_t>(data[2]) << 8);
        if (usage == 0x00CF) return true;
    }

    return false;
}

bool detectRecordPress(uint16_t vendorId, uint16_t productId, const uint8_t* data, size_t size) {
    if (isGrundigDevice(vendorId, productId)) {
        return isGrundigRecordPayload(data, size);
    }
    if (isPhilipsSpeechMikeDevice(vendorId, productId)) {
        return isPhilipsSpeechMikeRecordPayload(data, size);
    }
    if (isNordicDictationDevice(vendorId, productId)) {
        return isNordicDictationRecordPayload(data, size);
    }
    return false;
}

// ─── HID Event Dispatching (broadcast via WebSocket) ────────────
// Implementierungen stehen nach broadcastToClients() weiter unten,
// da sie jsonEscape() und broadcastToClients() voraussetzen.

void dispatchHidActionEvent(
    const std::wstring& deviceName,
    uint16_t vendorId,
    uint16_t productId,
    const char* phase
);

void dispatchHidStatusEvent();

void handleHidRecordEvent(uint16_t vendorId, uint16_t productId,
                          const std::wstring& deviceName, bool pressed);

void handleRawInputRecordPress(HRAWINPUT hRawInput);

// ─── HID Raw Input Registration ─────────────────────────────────

bool registerHidRawInputDevices() {
    if (g_hidRawInputRegistered) {
        hidDiagnostic("registerHidRawInputDevices: bereits registriert");
        return true;
    }

    hidDiagnostic("registerHidRawInputDevices: registriere Grundig(0xFF00:0x0001) + Philips(0xFFA0:0x0001) + Consumer(0x000C:0x0001)");

    // Registriere fuer alle Geraete mit RIDEV_INPUTSINK, damit wir
    // Reports auch dann bekommen, wenn das Fenster nicht im Vordergrund ist.
    RAWINPUTDEVICE devices[3] = {};

    // Grundig SonicMic: Usage Page 0xFF00 (Vendor-defined), Usage 0x0001
    devices[0].usUsagePage = 0xFF00;
    devices[0].usUsage = 0x0001;
    devices[0].dwFlags = RIDEV_INPUTSINK;
    devices[0].hwndTarget = g_hiddenWnd;

    // Philips SpeechMike III: Usage Page 0xFFA0 (Vendor-defined), Usage 0x0001
    // ACHTUNG: 0xFFA1/0x0003 ist FALSCH – der SpeechMike meldet sich auf 0xFFA0/0x0001!
    devices[1].usUsagePage = 0xFFA0;
    devices[1].usUsage = 0x0001;
    devices[1].dwFlags = RIDEV_INPUTSINK;
    devices[1].hwndTarget = g_hiddenWnd;

    // Consumer Controls (0x000C:0x0001) – Standard-HID-Seite fuer Media-Tasten
    // Viele Diktiermikrofone senden Record/Pause/Stop auch als Consumer-Control-Usage.
    devices[2].usUsagePage = 0x000C;
    devices[2].usUsage = 0x0001;
    devices[2].dwFlags = RIDEV_INPUTSINK;
    devices[2].hwndTarget = g_hiddenWnd;

    if (!RegisterRawInputDevices(devices, 3, sizeof(RAWINPUTDEVICE))) {
        DWORD err = GetLastError();
        hidDiagnostic("RegisterRawInputDevices FEHLGESCHLAGEN (error=%lu)", err);
        logLine("[HID] RegisterRawInputDevices FAILED (error=%lu)\n", err);
        fflush(stdout);
        return false;
    }

    g_hidRawInputRegistered = true;
    hidDiagnostic("RegisterRawInputDevices OK (3 Geraete, RIDEV_INPUTSINK, hwndTarget=0x%p)", g_hiddenWnd);
    logLine("[HID] RegisterRawInputDevices OK (3 devices)\n");
    fflush(stdout);
    return true;
}

void unregisterHidRawInputDevices() {
    if (!g_hidRawInputRegistered) return;

    RAWINPUTDEVICE devices[3] = {};

    devices[0].usUsagePage = 0xFF00;
    devices[0].usUsage = 0x0001;
    devices[0].dwFlags = RIDEV_REMOVE;
    devices[0].hwndTarget = nullptr;

    devices[1].usUsagePage = 0xFFA0;
    devices[1].usUsage = 0x0001;
    devices[1].dwFlags = RIDEV_REMOVE;
    devices[1].hwndTarget = nullptr;

    devices[2].usUsagePage = 0x000C;
    devices[2].usUsage = 0x0001;
    devices[2].dwFlags = RIDEV_REMOVE;
    devices[2].hwndTarget = nullptr;

    RegisterRawInputDevices(devices, 3, sizeof(RAWINPUTDEVICE));

    RegisterRawInputDevices(devices, 2, sizeof(RAWINPUTDEVICE));
    g_hidRawInputRegistered = false;
    logLine("[HID] UnregisterRawInputDevices OK\n");
    fflush(stdout);
}

// ─── HID Device State Tracking ──────────────────────────────────

HidDeviceState* findOrCreateHidDeviceState(uint16_t vendorId, uint16_t productId, const std::wstring& deviceName) {
    for (auto& dev : g_hidDevices) {
        if (dev.vendorId == vendorId && dev.productId == productId) {
            if (!deviceName.empty()) dev.deviceName = deviceName;
            return &dev;
        }
    }

    HidDeviceState newDev;
    newDev.vendorId = vendorId;
    newDev.productId = productId;
    newDev.deviceName = deviceName;
    newDev.recordPressed = false;
    g_hidDevices.push_back(newDev);
    return &g_hidDevices.back();
}

LRESULT CALLBACK HiddenWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (msg == WM_INPUT) {
        static DWORD lastLogTime = 0;
        DWORD now = GetTickCount();
        // Nur alle 2000ms loggen, um Spam bei schnellen Reports zu vermeiden
        if (now - lastLogTime > 2000) {
            lastLogTime = now;
            hidDiagnostic("WM_INPUT empfangen (Sekunden seit Start: %lu)", now / 1000);
        }
        handleRawInputRecordPress(reinterpret_cast<HRAWINPUT>(lParam));
        return DefWindowProc(hwnd, msg, wParam, lParam);
    }

    if (msg == WM_INPUT_DEVICE_CHANGE) {
        if (wParam == GIDC_ARRIVAL) {
            hidDiagnostic("Geraet angeschlossen (GIDC_ARRIVAL)");
            logLine("[HID] Device ARRIVAL detected\n");
            fflush(stdout);
            dispatchHidStatusEvent();
        } else if (wParam == GIDC_REMOVAL) {
            hidDiagnostic("Geraet entfernt (GIDC_REMOVAL)");
            logLine("[HID] Device REMOVAL detected\n");
            fflush(stdout);
            {
                std::lock_guard<std::mutex> lock(g_hidMutex);
                g_hidDevices.clear();
            }
            dispatchHidStatusEvent();
        }
        return DefWindowProc(hwnd, msg, wParam, lParam);
    }

    if (msg == WM_APP_DO_SENDINPUT) {
        auto* job = reinterpret_cast<SendInputJob*>(lParam);
        if (job && !job->inputs.empty()) {
            UINT sent = SendInput(static_cast<UINT>(job->inputs.size()),
                                  job->inputs.data(), sizeof(INPUT));
            job->result.set_value(sent);
        } else if (job) {
            job->result.set_value(0);
        }
        return 0;
    }

    if (msg == WM_APP_UPDATE_RECORDING_OVERLAY) {
        updateRecordingOverlayVisibility(wParam != 0);
        return 0;
    }

    return DefWindowProc(hwnd, msg, wParam, lParam);
}

void hiddenWindowThread() {
    hidDiagnostic("hiddenWindowThread gestartet");

    // Register a window class for the hidden window
    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = HiddenWndProc;
    wc.hInstance = GetModuleHandle(nullptr);
    wc.lpszClassName = L"SchreibdienstHiddenWnd";
    if (!RegisterClassExW(&wc)) {
        DWORD err = GetLastError();
        if (err != ERROR_CLASS_ALREADY_EXISTS) {
            hidDiagnostic("RegisterClassExW FEHLER (error=%lu)", err);
        }
    }

    g_hiddenWnd = CreateWindowExW(0, L"SchreibdienstHiddenWnd",
                                   L"", 0, 0, 0, 0, 0,
                                   HWND_MESSAGE, nullptr,
                                   GetModuleHandle(nullptr), nullptr);
    g_hiddenWndThreadId = GetCurrentThreadId();

    hidDiagnostic("HiddenWindow erstellt: hwnd=0x%p threadId=%lu", g_hiddenWnd, g_hiddenWndThreadId);

    // Alle aktuell angeschlossenen Raw-Input-Geraete auflisten
    enumerateAllRawInputDevices();

    // Register HID Raw Input für Diktiermikrofone (kein Admin nötig).
    registerHidRawInputDevices();

    // Signal that the window is ready
    SetEvent(g_hiddenWndReady);

    hidDiagnostic("Nachrichtenschleife gestartet – warte auf WM_INPUT...");

    // Message pump
    MSG msg;
    while (GetMessage(&msg, nullptr, 0, 0) > 0) {
        DispatchMessage(&msg);
    }

    hidDiagnostic("Nachrichtenschleife beendet (WM_QUIT)");
    // Cleanup HID registration before thread exits
    unregisterHidRawInputDevices();
}

// Replacement for direct SendInput – delegates to the hidden window thread.
UINT sendInputsViaHiddenWindow(const std::vector<INPUT>& inputs) {
    if (inputs.empty()) return 0;
    if (g_hiddenWnd == nullptr) return 0;

    // If we're already on the hidden window thread, call SendInput directly
    if (GetCurrentThreadId() == g_hiddenWndThreadId) {
        return SendInput(static_cast<UINT>(inputs.size()),
                         const_cast<INPUT*>(inputs.data()), sizeof(INPUT));
    }

    SendInputJob job;
    job.inputs = inputs;
    auto future = job.result.get_future();

    SendMessage(g_hiddenWnd, WM_APP_DO_SENDINPUT, 0, reinterpret_cast<LPARAM>(&job));

    // Wait with timeout
    auto status = future.wait_for(std::chrono::seconds(5));
    if (status == std::future_status::ready) {
        return future.get();
    }
    return 0;
}

// Wir registrieren jeden Hotkey in zwei Varianten: ohne Modifier und mit
// Shift. So kann auf Systemen, auf denen z. B. F9 durch eine andere App
// blockiert wird, einfach Shift+F9 (oder Shift+F10/Shift+F11/Shift+Escape)
// als Ausweich-Taste genutzt werden. Beide Varianten loesen dieselbe
// Aktion aus.
constexpr HotkeyBinding HOTKEY_BINDINGS[] = {
    {1,  VK_F9,     0,         "toggle-recording", "F9"},
    {2,  VK_F10,    0,         "stop-recording",   "F10"},
    {3,  VK_F11,    0,         "transfer-text",    "F11"},
    {4,  VK_ESCAPE, 0,         "cancel-recording", "Escape"},
    {5,  VK_F9,     MOD_SHIFT, "toggle-recording", "Shift+F9"},
    {6,  VK_F10,    MOD_SHIFT, "stop-recording",   "Shift+F10"},
    {7,  VK_F11,    MOD_SHIFT, "transfer-text",    "Shift+F11"},
    {8,  VK_ESCAPE, MOD_SHIFT, "cancel-recording", "Shift+Escape"},
};

// ─── UTF-8 / JSON helpers ───────────────────────────────────────

void appendCodePoint(std::wstring& output, std::uint32_t codePoint) {
    if (codePoint <= 0xFFFF) {
        output.push_back(static_cast<wchar_t>(codePoint));
        return;
    }

    codePoint -= 0x10000;
    output.push_back(static_cast<wchar_t>(0xD800 + (codePoint >> 10)));
    output.push_back(static_cast<wchar_t>(0xDC00 + (codePoint & 0x3FF)));
}

int hexValue(char value) {
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    if (value >= 'A' && value <= 'F') return value - 'A' + 10;
    return -1;
}

std::uint32_t parseHex4(const std::string& json, std::size_t offset) {
    if (offset + 4 > json.size()) {
        throw std::runtime_error("Invalid unicode escape");
    }

    std::uint32_t value = 0;
    for (std::size_t index = 0; index < 4; ++index) {
        const int digit = hexValue(json[offset + index]);
        if (digit < 0) {
            throw std::runtime_error("Invalid unicode escape");
        }
        value = (value << 4) | static_cast<std::uint32_t>(digit);
    }
    return value;
}

std::wstring parseJsonStringAt(const std::string& json, std::size_t& index) {
    if (index >= json.size() || json[index] != '"') {
        throw std::runtime_error("Expected JSON string");
    }

    ++index;
    std::wstring output;

    while (index < json.size()) {
        const unsigned char current = static_cast<unsigned char>(json[index++]);
        if (current == '"') {
            return output;
        }

        if (current == '\\') {
            if (index >= json.size()) {
                throw std::runtime_error("Invalid JSON escape");
            }

            const char escape = json[index++];
            switch (escape) {
                case '"': output.push_back(L'"'); break;
                case '\\': output.push_back(L'\\'); break;
                case '/': output.push_back(L'/'); break;
                case 'b': output.push_back(L'\b'); break;
                case 'f': output.push_back(L'\f'); break;
                case 'n': output.push_back(L'\n'); break;
                case 'r': output.push_back(L'\r'); break;
                case 't': output.push_back(L'\t'); break;
                case 'u': {
                    std::uint32_t codePoint = parseHex4(json, index);
                    index += 4;

                    if (codePoint >= 0xD800 && codePoint <= 0xDBFF) {
                        if (index + 6 <= json.size() && json[index] == '\\' && json[index + 1] == 'u') {
                            const std::uint32_t low = parseHex4(json, index + 2);
                            if (low >= 0xDC00 && low <= 0xDFFF) {
                                index += 6;
                                codePoint = 0x10000 + (((codePoint - 0xD800) << 10) | (low - 0xDC00));
                            }
                        }
                    }

                    appendCodePoint(output, codePoint);
                    break;
                }
                default:
                    throw std::runtime_error("Unsupported JSON escape");
            }
            continue;
        }

        if (current < 0x80) {
            output.push_back(static_cast<wchar_t>(current));
            continue;
        }

        std::uint32_t codePoint = 0;
        int continuationCount = 0;
        if ((current & 0xE0) == 0xC0) {
            codePoint = current & 0x1F;
            continuationCount = 1;
        } else if ((current & 0xF0) == 0xE0) {
            codePoint = current & 0x0F;
            continuationCount = 2;
        } else if ((current & 0xF8) == 0xF0) {
            codePoint = current & 0x07;
            continuationCount = 3;
        } else {
            throw std::runtime_error("Invalid UTF-8");
        }

        for (int part = 0; part < continuationCount; ++part) {
            if (index >= json.size()) {
                throw std::runtime_error("Invalid UTF-8");
            }
            const unsigned char continuation = static_cast<unsigned char>(json[index++]);
            if ((continuation & 0xC0) != 0x80) {
                throw std::runtime_error("Invalid UTF-8");
            }
            codePoint = (codePoint << 6) | (continuation & 0x3F);
        }

        appendCodePoint(output, codePoint);
    }

    throw std::runtime_error("Unterminated JSON string");
}

std::optional<std::size_t> findValueStart(const std::string& json, const std::string& key) {
    const std::string quotedKey = "\"" + key + "\"";
    const std::size_t keyPosition = json.find(quotedKey);
    if (keyPosition == std::string::npos) {
        return std::nullopt;
    }

    const std::size_t colon = json.find(':', keyPosition + quotedKey.size());
    if (colon == std::string::npos) {
        return std::nullopt;
    }

    std::size_t valueStart = colon + 1;
    while (valueStart < json.size() && (json[valueStart] == ' ' || json[valueStart] == '\t' || json[valueStart] == '\r' || json[valueStart] == '\n')) {
        ++valueStart;
    }
    return valueStart;
}

std::wstring getStringValue(const std::string& json, const std::string& key, const std::wstring& fallback = L"") {
    const auto valueStart = findValueStart(json, key);
    if (!valueStart || *valueStart >= json.size() || json[*valueStart] != '"') {
        return fallback;
    }

    std::size_t index = *valueStart;
    return parseJsonStringAt(json, index);
}

bool getBoolValue(const std::string& json, const std::string& key, bool fallback) {
    const auto valueStart = findValueStart(json, key);
    if (!valueStart) {
        return fallback;
    }

    if (json.compare(*valueStart, 4, "true") == 0) return true;
    if (json.compare(*valueStart, 5, "false") == 0) return false;
    return fallback;
}

std::uint32_t getUIntValue(const std::string& json, const std::string& key, std::uint32_t fallback) {
    const auto valueStart = findValueStart(json, key);
    if (!valueStart) {
        return fallback;
    }

    std::uint64_t value = 0;
    std::size_t index = *valueStart;
    bool foundDigit = false;
    while (index < json.size() && json[index] >= '0' && json[index] <= '9') {
        foundDigit = true;
        value = value * 10 + static_cast<std::uint64_t>(json[index] - '0');
        if (value > 60000) return fallback;
        ++index;
    }

    return foundDigit ? static_cast<std::uint32_t>(value) : fallback;
}

NativeRequest parseRequest(const std::string& json) {
    NativeRequest request;
    request.type = getStringValue(json, "type");
    request.requestId = getStringValue(json, "requestId");
    request.payload.text = getStringValue(json, "text");
    request.payload.mode = getStringValue(json, "mode", L"clipboard");
    request.payload.restorePreviousWindow = getBoolValue(json, "restorePreviousWindow", true);
    request.payload.delayMs = getUIntValue(json, "delayMs", 120);
    request.payload.charDelayMs = getUIntValue(json, "charDelayMs", 2);
    return request;
}

std::string asciiFromWide(const std::wstring& value) {
    std::string output;
    output.reserve(value.size());
    for (wchar_t ch : value) {
        output.push_back(ch >= 0 && ch <= 0x7F ? static_cast<char>(ch) : '?');
    }
    return output;
}

std::string jsonEscape(const std::string& value) {
    std::string escaped;
    escaped.reserve(value.size() + 8);
    for (const char current : value) {
        switch (current) {
            case '"': escaped += "\\\""; break;
            case '\\': escaped += "\\\\"; break;
            case '\n': escaped += "\\n"; break;
            case '\r': escaped += "\\r"; break;
            case '\t': escaped += "\\t"; break;
            default: escaped.push_back(current); break;
        }
    }
    return escaped;
}

std::string makeResponse(bool ok, const std::string& error = "", const std::string& mode = "clipboard", const std::string& requestId = "") {
    std::string response = "{\"type\":\"inject-result\",\"ok\":";
    response += ok ? "true" : "false";
    if (!requestId.empty()) {
        response += ",\"requestId\":\"" + jsonEscape(requestId) + "\"";
    }
    if (!mode.empty()) {
        response += ",\"mode\":\"" + jsonEscape(mode) + "\"";
    }
    if (!error.empty()) {
        response += ",\"error\":\"" + jsonEscape(error) + "\"";
    }
    response += "}";
    return response;
}

std::string makeTypedResponse(const std::string& type, bool ok, const std::string& error = "") {
    std::string response = "{\"type\":\"" + jsonEscape(type) + "\",\"ok\":";
    response += ok ? "true" : "false";
    if (!error.empty()) {
        response += ",\"error\":\"" + jsonEscape(error) + "\"";
    }
    response += "}";
    return response;
}

std::string makeHotkeyEventResponse(const HotkeyBinding& binding) {
    return "{\"type\":\"hotkey-event\",\"event\":{\"action\":\""
        + jsonEscape(binding.action)
        + "\",\"key\":\""
        + jsonEscape(binding.key)
        + "\"}}";
}

// ─── Hotkey management ──────────────────────────────────────────

const HotkeyBinding* findHotkeyBinding(WPARAM hotkeyId) {
    for (const auto& binding : HOTKEY_BINDINGS) {
        if (static_cast<WPARAM>(binding.id) == hotkeyId) {
            return &binding;
        }
    }

    return nullptr;
}

bool registerGlobalHotkeys(std::string& error) {
    for (const auto& binding : HOTKEY_BINDINGS) {
        if (!RegisterHotKey(nullptr, binding.id, MOD_NOREPEAT | binding.modifiers, binding.virtualKey)) {
            error = std::string("RegisterHotKey fehlgeschlagen für ") + binding.key;
            for (const auto& registered : HOTKEY_BINDINGS) {
                if (registered.id == binding.id) {
                    break;
                }
                UnregisterHotKey(nullptr, registered.id);
            }
            return false;
        }
    }

    return true;
}

void unregisterGlobalHotkeys() {
    for (const auto& binding : HOTKEY_BINDINGS) {
        UnregisterHotKey(nullptr, binding.id);
    }
}

// ─── WebSocket helpers ──────────────────────────────────────────

bool sendExact(SOCKET s, const void* data, int len) {
    int sent = 0;
    while (sent < len) {
        int n = ::send(s, static_cast<const char*>(data) + sent, len - sent, 0);
        if (n <= 0) return false;
        sent += n;
    }
    return true;
}

bool recvExact(SOCKET s, void* buf, int len) {
    int received = 0;
    while (received < len) {
        int n = ::recv(s, static_cast<char*>(buf) + received, len - received, 0);
        if (n <= 0) return false;
        received += n;
    }
    return true;
}

std::string recvLine(SOCKET s) {
    std::string line;
    char c;
    while (true) {
        int n = ::recv(s, &c, 1, 0);
        if (n <= 0) return "";
        if (c == '\r') continue;
        if (c == '\n') return line;
        line.push_back(c);
    }
}

bool sendWsFrame(SOCKET s, uint8_t opcode, const std::string& payload) {
    std::vector<uint8_t> frame;
    frame.push_back(0x80 | (opcode & 0x0F)); // FIN + opcode (server never masks)

    size_t len = payload.size();
    if (len <= 125) {
        frame.push_back(static_cast<uint8_t>(len));
    } else if (len <= 65535) {
        frame.push_back(126);
        frame.push_back(static_cast<uint8_t>(len >> 8));
        frame.push_back(static_cast<uint8_t>(len));
    } else {
        frame.push_back(127);
        for (int i = 7; i >= 0; --i)
            frame.push_back(static_cast<uint8_t>(len >> (i * 8)));
    }

    frame.insert(frame.end(), payload.begin(), payload.end());
    return sendExact(s, frame.data(), static_cast<int>(frame.size()));
}

struct WsFrame {
    bool fin = true;
    uint8_t opcode = 0;
    std::string payload;
};

std::optional<WsFrame> recvWsFrame(SOCKET s) {
    // Read first 2 bytes
    uint8_t header[2];
    if (!recvExact(s, header, 2)) return std::nullopt;

    WsFrame frame;
    frame.fin = (header[0] & 0x80) != 0;
    frame.opcode = header[0] & 0x0F;
    bool masked = (header[1] & 0x80) != 0;
    uint64_t payloadLen = header[1] & 0x7F;

    if (payloadLen == 126) {
        uint8_t ext[2];
        if (!recvExact(s, ext, 2)) return std::nullopt;
        payloadLen = (static_cast<uint64_t>(ext[0]) << 8) | ext[1];
    } else if (payloadLen == 127) {
        uint8_t ext[8];
        if (!recvExact(s, ext, 8)) return std::nullopt;
        payloadLen = 0;
        for (int i = 0; i < 8; ++i)
            payloadLen = (payloadLen << 8) | ext[i];
    }

    if (payloadLen > 16 * 1024 * 1024) return std::nullopt; // 16 MB max

    uint8_t maskKey[4] = {0, 0, 0, 0};
    if (masked) {
        if (!recvExact(s, maskKey, 4)) return std::nullopt;
    }

    std::string payload(static_cast<size_t>(payloadLen), '\0');
    if (payloadLen > 0) {
        if (!recvExact(s, payload.data(), static_cast<int>(payloadLen))) return std::nullopt;
    }

    if (masked) {
        for (size_t i = 0; i < payload.size(); ++i)
            payload[i] ^= maskKey[i % 4];
    }

    frame.payload = std::move(payload);
    return frame;
}

bool wsHandshake(SOCKET s) {
    // Read HTTP upgrade request
    std::string key;
    bool isGet = false;

    std::string firstLine = recvLine(s);
    if (firstLine.find("GET ") == 0) isGet = true;

    while (true) {
        std::string header = recvLine(s);
        if (header.empty()) break; // end of headers

        auto pos = header.find("Sec-WebSocket-Key: ");
        if (pos == 0) {
            key = header.substr(19);
            // Trim trailing whitespace
            while (!key.empty() && (key.back() == ' ' || key.back() == '\r'))
                key.pop_back();
        }
    }

    if (!isGet || key.empty()) return false;

    std::string accept = base64Encode(sha1(key + WS_MAGIC_GUID));

    std::string response =
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: " + accept + "\r\n"
        "\r\n";

    return sendExact(s, response.data(), static_cast<int>(response.size()));
}

// ─── Broadcast to all connected WebSocket clients ───────────────

void broadcastToClients(const std::string& message) {
    std::lock_guard<std::mutex> lock(g_clientsMutex);
    for (auto it = g_wsClients.begin(); it != g_wsClients.end(); ) {
        if (!sendWsFrame(*it, 0x1, message)) {
            closesocket(*it);
            it = g_wsClients.erase(it);
        } else {
            ++it;
        }
    }
}

// ─── HID Event Response Builders ────────────────────────────────

std::string makeHidEventResponse(
    const std::wstring& deviceName,
    uint16_t vendorId,
    uint16_t productId,
    const char* phase
) {
    std::string response = "{\"type\":\"hid-event\",\"event\":{";
    response += "\"action\":\"record\",";
    response += "\"phase\":\"" + std::string(phase) + "\",";
    response += "\"deviceName\":\"" + jsonEscape(asciiFromWide(deviceName)) + "\",";
    response += "\"vendorId\":" + std::to_string(vendorId) + ",";
    response += "\"productId\":" + std::to_string(productId);
    response += "}}";
    return response;
}

std::string makeHidStatusResponse() {
    std::lock_guard<std::mutex> lock(g_hidStatusMutex);
    std::string response = "{\"type\":\"hid-status\",";
    response += "\"connected\":" + std::string(g_hidDevices.empty() ? "false" : "true");
    if (!g_hidDevices.empty() && !g_hidLastDeviceName.empty()) {
        response += ",\"deviceName\":\"" + jsonEscape(asciiFromWide(g_hidLastDeviceName)) + "\"";
    }
    response += "}";
    return response;
}

std::string makeHidDeviceConnectedResponse(bool connected, const std::wstring& deviceName) {
    std::string response = "{\"type\":\"hid-device-connected\",";
    response += "\"connected\":" + std::string(connected ? "true" : "false");
    if (!deviceName.empty()) {
        response += ",\"deviceName\":\"" + jsonEscape(asciiFromWide(deviceName)) + "\"";
    }
    response += "}";
    return response;
}

// ─── HID Event Dispatching ──────────────────────────────────────

void dispatchHidActionEvent(
    const std::wstring& deviceName,
    uint16_t vendorId,
    uint16_t productId,
    const char* phase
) {
    // Nur broadcasten, wenn mindestens ein Client verbunden ist
    {
        std::lock_guard<std::mutex> lock(g_clientsMutex);
        if (g_wsClients.empty()) return;
    }

    const std::string message = makeHidEventResponse(deviceName, vendorId, productId, phase);
    broadcastToClients(message);

    logLine("[HID] dispatchHidActionEvent device=\"%ls\" phase=%s\n",
           deviceName.c_str(), phase);
    fflush(stdout);
}

void dispatchHidStatusEvent() {
    const std::string message = makeHidStatusResponse();
    broadcastToClients(message);
}

void handleHidRecordEvent(uint16_t vendorId, uint16_t productId,
                          const std::wstring& deviceName, bool pressed) {
    {
        std::lock_guard<std::mutex> lock(g_hidStatusMutex);
        g_hidLastDeviceName = deviceName;
    }

    // WICHTIG: Der Native Host toggelt g_recordingState hier NICHT mehr selbst.
    // Frueher rief er setRecordingState(!g_recordingState, ...) auf und
    // gleichzeitig hat das Frontend auf das weitergeleitete keydown-Event seinen
    // eigenen State getoggelt. Das waren zwei unabhaengige Toggle-Zustandsmaschinen,
    // die bei jedem Klick beide umschalteten und dauerhaft auseinander liefen,
    // sobald das Frontend z. B. noch in einem langen stopRecording() (>15 s
    // VAD-Flush) hing. Jetzt ist das Frontend die alleinige Source of Truth
    // (genau wie im WebHID-Modus). Es meldet seinen recording-Status via
    // reportInjectorRecordingState() an den Host zurueck, der dann Overlay und
    // Tray-Icon konsistent setzt.
    if (pressed) {
        dispatchHidActionEvent(deviceName, vendorId, productId, "keydown");

        logLine("[HID] Record PRESS from device=\"%ls\" (vendor=0x%04X product=0x%4X)\n",
               deviceName.c_str(), vendorId, productId);
        fflush(stdout);
    } else {
        dispatchHidActionEvent(deviceName, vendorId, productId, "keyup");
        logLine("[HID] Record RELEASE from device=\"%ls\"\n", deviceName.c_str());
        fflush(stdout);
    }
}

void handleRawInputRecordPress(HRAWINPUT hRawInput) {
    UINT size = 0;
    GetRawInputData(hRawInput, RID_INPUT, nullptr, &size, sizeof(RAWINPUTHEADER));
    if (size == 0) {
        hidDiagnostic("handleRawInput: GetRawInputData size=0 -> Abbruch");
        return;
    }

    std::vector<uint8_t> buffer(size);
    if (GetRawInputData(hRawInput, RID_INPUT, buffer.data(), &size, sizeof(RAWINPUTHEADER)) != size) {
        hidDiagnostic("handleRawInput: GetRawInputData buffer-Fehler");
        return;
    }

    const RAWINPUT* raw = reinterpret_cast<const RAWINPUT*>(buffer.data());

    // Kein HID? Ignorieren – aber nicht loggen (würde bei jedem
    // WM_INPUT eines Nicht-HID-Geräts rauschen).
    if (raw->header.dwType != RIM_TYPEHID) {
        return;
    }

    // Geräte-Info auslesen (Vendor/Product ID)
    RID_DEVICE_INFO deviceInfo{};
    deviceInfo.cbSize = sizeof(deviceInfo);
    UINT deviceInfoSize = sizeof(deviceInfo);

    if (GetRawInputDeviceInfoW(raw->header.hDevice, RIDI_DEVICEINFO,
                               &deviceInfo, &deviceInfoSize) != sizeof(deviceInfo)) {
        return;
    }

    if (deviceInfo.dwType != RIM_TYPEHID) {
        return;
    }

    const uint16_t vendorId = deviceInfo.hid.dwVendorId;
    const uint16_t productId = deviceInfo.hid.dwProductId;
    const DWORD usagePage = deviceInfo.hid.usUsagePage;
    const DWORD usage = deviceInfo.hid.usUsage;

    // Ungenutzte Geräte: Nur beim ersten Mal loggen, dann stillschweigend
    // ignorieren. Typischerweise sind das Mäuse, Tastaturen oder
    // Philips-Geräte (VID=0x0600), die per WM_INPUT rauschen.
    if (!isSupportedHidDevice(vendorId, productId)) {
        static std::set<uint32_t> ignoredDevicesLogged;
        static std::mutex ignoredMutex;
        const uint32_t key = (static_cast<uint32_t>(vendorId) << 16) | productId;
        {
            std::lock_guard<std::mutex> lock(ignoredMutex);
            if (ignoredDevicesLogged.insert(key).second) {
                hidDiagnostic("Unterstuetztes Geraet ignoriert (VID=0x%04X PID=0x%04X UsagePage=0x%04X Usage=0x%04X) – einmalige Meldung",
                              vendorId, productId, usagePage, usage);
            }
        }
        return;
    }

    // Gerätename auslesen
    UINT nameLen = 0;
    GetRawInputDeviceInfoW(raw->header.hDevice, RIDI_DEVICENAME, nullptr, &nameLen);
    std::wstring deviceName;
    if (nameLen > 0) {
        std::vector<wchar_t> nameBuf(nameLen);
        if (GetRawInputDeviceInfoW(raw->header.hDevice, RIDI_DEVICENAME,
                                   nameBuf.data(), &nameLen) > 0) {
            deviceName = nameBuf.data();
            // Extrahiere nur den letzten Teil des Device-Pfads
            const size_t lastHash = deviceName.find_last_of(L'#');
            if (lastHash != std::wstring::npos && lastHash + 1 < deviceName.size()) {
                deviceName = deviceName.substr(lastHash + 1);
                const size_t nextHash = deviceName.find(L'#');
                if (nextHash != std::wstring::npos) {
                    deviceName = deviceName.substr(0, nextHash);
                }
            }
        }
    }

    if (deviceName.empty()) {
        deviceName = isGrundigDevice(vendorId, productId)
            ? L"Grundig SonicMic"
            : isPhilipsSpeechMikeDevice(vendorId, productId)
                ? L"Philips SpeechMike III"
                : L"USB Diktiermikrofon (Nordic)";
    }

    // Report-Daten prüfen
    const uint8_t* reportData = raw->data.hid.bRawData;
    const DWORD reportSize = raw->data.hid.dwSizeHid;

    // Record-Taste erkennen – abhaengig von UsagePage
    bool recordPressed = false;

    if (usagePage == 0x000C) {
        // Consumer Controls (standard HID): Usage 0xB2 = Media Record.
        // Nordic-Diktiermikrofon: sendet 16-bit Usage 0x00CF statt 0xB2.
        if (isNordicDictationDevice(vendorId, productId)) {
            recordPressed = isNordicDictationRecordPayload(reportData, reportSize);
            // Nordic-Gerät: nur bei echtem Tastendruck (0x00CF) loggen.
            // Releases (0x0000) sind reines Rauschen – stillschweigend debouncen.
            if (recordPressed) {
                size_t logSize = reportSize;
                if (logSize > 10) logSize = 10;
                hidDiagnostic("handleRawInput: HID-Report size=%lu bytes=[%s] – Nordic Record (0x00CF)",
                              reportSize, hexDump(reportData, logSize).c_str());
            }
        } else {
            size_t logSize = reportSize;
            if (logSize > 10) logSize = 10;
            hidDiagnostic("handleRawInput: Consumer-Control-Report (0x000C:0x0001) size=%lu bytes=[%s]",
                          reportSize, hexDump(reportData, logSize).c_str());
            bool anyNonZero = false;
            for (DWORD i = 0; i < reportSize; ++i) {
                if (reportData[i] == 0xB2) {
                    recordPressed = true;
                    hidDiagnostic("handleRawInput: Consumer Record (0xB2) detected");
                    break;
                }
                if (reportData[i] != 0x00) anyNonZero = true;
            }
            // Wenn unerwartete Bytes kommen, logge sie zur Diagnose
            if (anyNonZero && !recordPressed) {
                hidDiagnostic("handleRawInput: Unbekannter Consumer-Control-Code (nicht Record)");
            }
        }
    } else {
        // Vendor-definierte Seiten (0xFF00 Grundig, 0xFFA0 Philips):
        // Bekannte Record-Payloads erkennen
        recordPressed = detectRecordPress(vendorId, productId, reportData, reportSize);
        size_t logSize = reportSize;
        if (logSize > 10) logSize = 10;
        hidDiagnostic("handleRawInput: Vendor-Report size=%lu bytes=[%s]",
                      reportSize, hexDump(reportData, logSize).c_str());
    }

    // Nur bei echten Aktionen loggen – stilles Debounce reicht nicht für eine Meldung
    const bool isNordic = isNordicDictationDevice(vendorId, productId);
    if (!isNordic || recordPressed) {
        hidDiagnostic("handleRawInput: recordPressed=%d (vor Debounce)", recordPressed ? 1 : 0);
    }

    // Debounce: nur bei Zustandsänderung reagieren
    HidDeviceState* deviceState = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_hidMutex);
        deviceState = findOrCreateHidDeviceState(vendorId, productId, deviceName);
    }

    if (deviceState && deviceState->recordPressed == recordPressed) {
        // Nur loggen, wenn es ein unerwarteter Doppel-Press ist (recordPressed=1).
        // Releases (recordPressed=0) sind immer der erwartete Folgezustand.
        if (recordPressed) {
            hidDiagnostic("handleRawInput: Debounce – Doppel-Press ignoriert");
        }
        return;
    }

    {
        std::lock_guard<std::mutex> lock(g_hidMutex);
        deviceState = findOrCreateHidDeviceState(vendorId, productId, deviceName);
        deviceState->recordPressed = recordPressed;
    }

    hidDiagnostic("handleRawInput: Event dispatch – device=\"%ls\" phase=%s",
                  deviceName.c_str(), recordPressed ? "keydown" : "keyup");

    handleHidRecordEvent(vendorId, productId, deviceName, recordPressed);
}

// ─── Hotkey listener (broadcasts via WebSocket) ─────────────────

bool startHotkeyListener(HotkeyListener& listener, std::string& error) {
    if (listener.thread.joinable()) {
        return true;
    }

    std::promise<std::pair<bool, std::string>> readyPromise;
    auto readyFuture = readyPromise.get_future();

    listener.thread = std::thread([&listener, readyPromise = std::move(readyPromise)]() mutable {
        listener.threadId = GetCurrentThreadId();

        MSG queueMessage{};
        PeekMessage(&queueMessage, nullptr, WM_USER, WM_USER, PM_NOREMOVE);

        std::string registrationError;
        if (!registerGlobalHotkeys(registrationError)) {
            readyPromise.set_value({false, registrationError});
            listener.threadId = 0;
            return;
        }

        listener.running = true;
        readyPromise.set_value({true, ""});

        MSG message{};
        while (GetMessage(&message, nullptr, 0, 0) > 0) {
            if (message.message != WM_HOTKEY) {
                continue;
            }

            const HotkeyBinding* binding = findHotkeyBinding(message.wParam);
            if (binding == nullptr) {
                continue;
            }

            const std::string action(binding->action);
            if (action == "toggle-recording") {
                const bool nowRecording = !g_recordingState.load();
                setRecordingState(nowRecording, L"hotkey", false);
            } else if (action == "stop-recording" || action == "cancel-recording") {
                setRecordingState(false, L"hotkey", false);
            }

            broadcastToClients(makeHotkeyEventResponse(*binding));
        }

        unregisterGlobalHotkeys();
        listener.running = false;
        listener.threadId = 0;
    });

    const auto [ok, startupError] = readyFuture.get();
    if (!ok) {
        error = startupError;
        if (listener.thread.joinable()) {
            listener.thread.join();
        }
        return false;
    }

    return true;
}

void stopHotkeyListener(HotkeyListener& listener) {
    if (!listener.thread.joinable()) {
        listener.running = false;
        listener.threadId = 0;
        return;
    }

    if (listener.threadId != 0) {
        PostThreadMessage(listener.threadId, WM_QUIT, 0, 0);
    }

    listener.thread.join();
    listener.running = false;
    listener.threadId = 0;
}

// ─── SendInput helpers ──────────────────────────────────────────

bool sendInputs(const std::vector<INPUT>& inputs) {
    constexpr std::size_t chunkSize = 2048;
    std::size_t offset = 0;
    while (offset < inputs.size()) {
        const std::size_t count = std::min(chunkSize, inputs.size() - offset);
        std::vector<INPUT> chunk(inputs.begin() + offset, inputs.begin() + offset + count);
        const UINT sent = sendInputsViaHiddenWindow(chunk);
        if (sent != count) {
            return false;
        }
        offset += count;
    }
    return true;
}

INPUT makeVirtualKeyInput(WORD key, bool keyUp) {
    INPUT input{};
    input.type = INPUT_KEYBOARD;
    input.ki.wVk = key;
    input.ki.dwFlags = keyUp ? KEYEVENTF_KEYUP : 0;
    return input;
}

INPUT makeUnicodeInput(wchar_t unit, bool keyUp) {
    INPUT input{};
    input.type = INPUT_KEYBOARD;
    input.ki.wScan = static_cast<WORD>(unit);
    input.ki.dwFlags = KEYEVENTF_UNICODE | (keyUp ? KEYEVENTF_KEYUP : 0);
    return input;
}

// ─── Clipboard helpers ──────────────────────────────────────────

enum class PasteOutcome {
    Success,
    Failed,
    ClipboardBlocked,
};

struct ClipboardSnapshot {
    bool hasText = false;
    std::wstring text;
};

ClipboardSnapshot readClipboardText() {
    ClipboardSnapshot snapshot;
    if (!OpenClipboard(nullptr)) {
        return snapshot;
    }

    HANDLE clipboardData = GetClipboardData(CF_UNICODETEXT);
    if (clipboardData != nullptr) {
        const auto* locked = static_cast<const wchar_t*>(GlobalLock(clipboardData));
        if (locked != nullptr) {
            snapshot.hasText = true;
            snapshot.text = locked;
            GlobalUnlock(clipboardData);
        }
    }

    CloseClipboard();
    return snapshot;
}

bool writeClipboardText(const std::wstring& text) {
    if (!OpenClipboard(nullptr)) {
        return false;
    }

    if (!EmptyClipboard()) {
        CloseClipboard();
        return false;
    }

    const std::size_t bytes = (text.size() + 1) * sizeof(wchar_t);
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
    if (memory == nullptr) {
        CloseClipboard();
        return false;
    }

    auto* target = static_cast<wchar_t*>(GlobalLock(memory));
    if (target == nullptr) {
        GlobalFree(memory);
        CloseClipboard();
        return false;
    }

    std::copy(text.begin(), text.end(), target);
    target[text.size()] = L'\0';
    GlobalUnlock(memory);

    if (SetClipboardData(CF_UNICODETEXT, memory) == nullptr) {
        GlobalFree(memory);
        CloseClipboard();
        return false;
    }

    CloseClipboard();
    return true;
}

bool restoreClipboardText(const ClipboardSnapshot& snapshot) {
    if (!snapshot.hasText) {
        if (!OpenClipboard(nullptr)) {
            return false;
        }
        const bool emptied = EmptyClipboard() != FALSE;
        CloseClipboard();
        return emptied;
    }

    return writeClipboardText(snapshot.text);
}

bool sendPasteShortcut() {
    const std::vector<INPUT> inputs = {
        makeVirtualKeyInput(VK_CONTROL, false),
        makeVirtualKeyInput('V', false),
        makeVirtualKeyInput('V', true),
        makeVirtualKeyInput(VK_CONTROL, true),
    };
    return sendInputs(inputs);
}

PasteOutcome pasteClipboardText(const std::wstring& text) {
    logLine("[INJECT] pasteClipboardText START text=\"%ls\" (len=%zu)\n",
           text.substr(0, 80).c_str(), text.size());
    fflush(stdout);

    // 1) Aktuelle Zwischenablage sichern
    ClipboardSnapshot snapshot = readClipboardText();

    // 2) Neuen Text in die Zwischenablage schreiben
    if (!writeClipboardText(text)) {
        logLine("[INJECT] pasteClipboardText FAILED: writeClipboardText → ClipboardBlocked\n");
        fflush(stdout);
        return PasteOutcome::ClipboardBlocked;
    }

    // Kurz warten, bis die Zwischenablage aktualisiert ist
    std::this_thread::sleep_for(std::chrono::milliseconds(CLIPBOARD_READY_DELAY_MS));

    // 3) Ctrl+V senden
    if (!sendPasteShortcut()) {
        logLine("[INJECT] pasteClipboardText FAILED: sendPasteShortcut → ClipboardBlocked\n");
        fflush(stdout);
        restoreClipboardText(snapshot);
        return PasteOutcome::ClipboardBlocked;
    }

    // Kurz warten, damit die Ziel-App den Paste-Vorgang abschließen kann
    std::this_thread::sleep_for(std::chrono::milliseconds(CLIPBOARD_RESTORE_DELAY_MS));

    // 4) Ursprüngliche Zwischenablage wiederherstellen
    if (!restoreClipboardText(snapshot)) {
        logLine("[INJECT] pasteClipboardText WARNING: clipboard restore failed\n");
        fflush(stdout);
    }

    // 5) Hinweis: Ob die Ziel-App den Paste angenommen oder ignoriert hat,
    //    können wir hier nicht sicher erkennen, weil der Clipboard-Text
    //    auch nach erfolgreichem Paste erhalten bleibt.
    logLine("[INJECT] pasteClipboardText SUCCESS\n");
    fflush(stdout);
    return PasteOutcome::Success;
}

// Versucht, ein bestimmtes Fenster via SetForegroundWindow in den
// Vordergrund zu holen. Nutzt den AttachThreadInput-Trick, um die
// foreground-lock-Zeitbeschränkung zu umgehen.
bool forceForegroundWindow(HWND target) {
    if (target == nullptr || !IsWindow(target)) return false;
    if (GetForegroundWindow() == target) return true; // Bereits im Vordergrund

    // Falls minimiert: wiederherstellen
    if (IsIconic(target)) {
        ShowWindow(target, SW_RESTORE);
    }

    // AttachThreadInput-Trick: Erlaubt SetForegroundWindow auch ohne
    // foreground-lock-Berechtigung (z. B. wenn der Injector selbst kein
    // aktives Fenster hat / im Hintergrund läuft).
    const DWORD currentThreadId = GetCurrentThreadId();
    const DWORD targetThreadId = GetWindowThreadProcessId(target, nullptr);
    const DWORD foregroundThreadId = GetWindowThreadProcessId(GetForegroundWindow(), nullptr);

    bool attached1 = false;
    bool attached2 = false;

    if (foregroundThreadId != 0 && foregroundThreadId != currentThreadId) {
        attached1 = AttachThreadInput(currentThreadId, foregroundThreadId, TRUE) != 0;
    }
    if (targetThreadId != currentThreadId && targetThreadId != foregroundThreadId) {
        attached2 = AttachThreadInput(currentThreadId, targetThreadId, TRUE) != 0;
    }

    // Fenster kurz auf topmost setzen, dann zurücksetzen – hilft bei
    // manchen Anwendungen, die sonst nicht in den Vordergrund kommen.
    SetWindowPos(target, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    const BOOL result = SetForegroundWindow(target);
    SetWindowPos(target, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);

    // Thread-Input wieder trennen
    if (attached2) AttachThreadInput(currentThreadId, targetThreadId, FALSE);
    if (attached1) AttachThreadInput(currentThreadId, foregroundThreadId, FALSE);

    return result != 0;
}

// Aktiviert das Ziel-Fenster für die Text-Injection. Verwendet eine
// mehrstufige Strategie:
// 1. Gespeichertes HWND (g_targetWindow) – schnell und präzise
// 2. Fenster-Suche per Titel/Class-Pattern – robuster nach Neustart
// 3. Alt+Tab – Fallback wenn nichts konfiguriert ist
bool activatePreviousWindow(std::uint32_t delayMs) {
    HWND target = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_targetWindowMutex);
        target = g_targetWindow;
    }

    // Strategie 1: Gespeichertes HWND nutzen
    if (target != nullptr && IsWindow(target) && IsWindowVisible(target)) {
        logLine("[INJECT] activatePreviousWindow: trying saved HWND 0x%p\n", target);
        fflush(stdout);
        if (forceForegroundWindow(target)) {
            if (delayMs > 0) {
                std::this_thread::sleep_for(std::chrono::milliseconds(delayMs));
            }
            return true;
        }
        logLine("[INJECT] activatePreviousWindow: saved HWND failed, invalidating\n");
        fflush(stdout);
        // HWND ist ungültig geworden → zurücksetzen
        std::lock_guard<std::mutex> lock(g_targetWindowMutex);
        g_targetWindow = nullptr;
    }

    // Strategie 2: Fenster per Titel/Class-Pattern suchen
    HWND foundByPattern = findTargetWindowByPattern();
    if (foundByPattern != nullptr) {
        logLine("[INJECT] activatePreviousWindow: found by pattern 0x%p\n", foundByPattern);
        fflush(stdout);
        if (forceForegroundWindow(foundByPattern)) {
            // Gefundenes Fenster als neues Target merken
            std::lock_guard<std::mutex> lock(g_targetWindowMutex);
            g_targetWindow = foundByPattern;
            if (delayMs > 0) {
                std::this_thread::sleep_for(std::chrono::milliseconds(delayMs));
            }
            return true;
        }
    }

    // Strategie 3: Alt+Tab als Fallback
    logLine("[INJECT] activatePreviousWindow: falling back to Alt+Tab\n");
    fflush(stdout);
    std::vector<INPUT> inputs;
    inputs.push_back(makeVirtualKeyInput(VK_MENU, false));
    inputs.push_back(makeVirtualKeyInput(VK_TAB, false));
    inputs.push_back(makeVirtualKeyInput(VK_TAB, true));
    inputs.push_back(makeVirtualKeyInput(VK_MENU, true));

    if (!sendInputs(inputs)) {
        return false;
    }

    if (delayMs > 0) {
        std::this_thread::sleep_for(std::chrono::milliseconds(delayMs));
    }
    return true;
}

bool sendUnicodeText(const std::wstring& text, std::uint32_t charDelayMs) {
    if (charDelayMs > 0) {
        for (const wchar_t unit : text) {
            const std::vector<INPUT> inputs = {
                makeUnicodeInput(unit, false),
                makeUnicodeInput(unit, true),
            };

            if (!sendInputs(inputs)) {
                return false;
            }

            std::this_thread::sleep_for(std::chrono::milliseconds(charDelayMs));
        }

        return true;
    }

    std::vector<INPUT> inputs;
    inputs.reserve(text.size() * 2);

    for (const wchar_t unit : text) {
        inputs.push_back(makeUnicodeInput(unit, false));
        inputs.push_back(makeUnicodeInput(unit, true));
    }

    const bool ok = sendInputs(inputs);

    // Nachlauf-Pause: SendInput kehrt zurück, sobald die Events in der
    // Windows-Input-Queue liegen, NICHT sobald die Ziel-App sie verarbeitet
    // hat. Ein kurzer flat Sleep reicht, damit der Input ankommt.
    if (ok && !text.empty()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(30));
    }

    return ok;
}

// ─── Target-Window speichern ────────────────────────────────────

void saveTargetWindow() {
    HWND foreground = GetForegroundWindow();
    if (foreground == nullptr) return;

    std::lock_guard<std::mutex> lock(g_targetWindowMutex);
    g_targetWindow = foreground;

    // Auch Titel und Klassenname für spätere Wiedererkennung speichern,
    // falls das HWND ungültig wird (z. B. nach App-Neustart).
    wchar_t titleBuf[512] = {};
    GetWindowTextW(foreground, titleBuf, static_cast<int>(std::size(titleBuf)));
    if (wcslen(titleBuf) > 0) {
        g_targetWindowTitlePattern = titleBuf;
    }

    wchar_t classBuf[256] = {};
    GetClassNameW(foreground, classBuf, static_cast<int>(std::size(classBuf)));
    if (wcslen(classBuf) > 0) {
        g_targetWindowClassName = classBuf;
    }

    logLine("[INJECT] saveTargetWindow: HWND=0x%p title=\"%ls\" class=\"%ls\"\n",
           foreground, titleBuf, classBuf);
    fflush(stdout);
}

// ─── Request handler ────────────────────────────────────────────

std::string handleRequest(const std::string& message) {
    NativeRequest request;
    try {
        request = parseRequest(message);
    } catch (const std::exception& /*error*/) {
        // Fehlertext absichtlich generisch für Robustheit
        return makeResponse(false, "Invalid request", "");
    }

    const std::string requestId = asciiFromWide(request.requestId);

    if (request.type != L"inject-text") {
        return makeResponse(false, "Unknown message type", "", requestId);
    }
    if (request.payload.text.empty()) {
        return makeResponse(false, "No text to inject", "", requestId);
    }

    // Immer clipboard als primären Modus erzwingen – das Frontend könnte
    // veraltetes JavaScript ausgeliefert haben, das "sendinput" sendet.
    request.payload.mode = L"clipboard";

    std::lock_guard<std::mutex> injectLock(g_injectMutex);

    // Deduplizierung: Derselbe Text darf nicht innerhalb INJECT_DEDUP_WINDOW
    // erneut injected werden. Der Client macht bei Timeout einen Retry, der
    // erste Request wurde dann aber bereits verarbeitet.
    {
        std::lock_guard<std::mutex> dedupLock(g_injectDedupMutex);
        const auto now = std::chrono::steady_clock::now();
        if (g_lastInjectDedup.text == request.payload.text &&
            (now - g_lastInjectDedup.timestamp) < INJECT_DEDUP_WINDOW) {
            logLine("[INJECT] handleRequest DEDUP SUPPRESSED (duplicate text within %llds)\n",
                   static_cast<long long>(INJECT_DEDUP_WINDOW.count()));
            fflush(stdout);
            return makeResponse(true, "", asciiFromWide(request.payload.mode), requestId);
        }
        g_lastInjectDedup.text = request.payload.text;
        g_lastInjectDedup.timestamp = now;
    }

    // Convert text to narrow string for logging (truncate at 80 chars)
    std::string narrowText;
    const size_t logLen = std::min(request.payload.text.size(), (size_t)80);
    narrowText.resize(logLen, '?');
    std::wcstombs(&narrowText[0], request.payload.text.c_str(), logLen);

    logLine("[INJECT] handleRequest mode=%ls restorePrev=%d delayMs=%u text=\"%s\" (len=%zu)\n",
           request.payload.mode.c_str(),
           request.payload.restorePreviousWindow,
           request.payload.delayMs,
           narrowText.c_str(),
           request.payload.text.size());
    fflush(stdout);

    if (request.payload.restorePreviousWindow && !activatePreviousWindow(request.payload.delayMs)) {
        logLine("[INJECT] handleRequest FAILED: Alt-Tab failed\n");
        fflush(stdout);
        return makeResponse(false, "Alt-Tab focus handover failed", "", requestId);
    }

    // Prüfen, ob die Ziel-App in der Blockliste für Clipboard steht
    // (z. B. ccpnet.exe). Wenn ja, direkt SendInput statt Clipboard.
    // GetForegroundWindow() verwenden – activatePreviousWindow() hat die
    // Ziel-App bereits in den Vordergrund geholt, und g_targetWindow zeigt
    // noch auf die vorherige App.
    {
        HWND targetWnd = GetForegroundWindow();
        if (isClipboardBlockedForTarget(targetWnd)) {
            // Clipboard überspringen, direkt SendInput
            if (request.payload.delayMs > 0) {
                std::this_thread::sleep_for(std::chrono::milliseconds(request.payload.delayMs));
            }
            if (sendUnicodeText(request.payload.text, request.payload.charDelayMs)) {
                logLine("[INJECT] handleRequest SUCCESS (sendinput, clipboard blocked by target)\n");
                fflush(stdout);
                saveTargetWindow();
                return makeResponse(true, "", "sendinput", requestId);
            }
            logLine("[INJECT] handleRequest FAILED: SendInput (clipboard blocked by target)\n");
            fflush(stdout);
            return makeResponse(false, "SendInput failed (clipboard blocked by target app)", "", requestId);
        }
    }

    if (request.payload.mode != L"clipboard" && request.payload.delayMs > 0) {
        std::this_thread::sleep_for(std::chrono::milliseconds(request.payload.delayMs));
    }

    if (request.payload.mode == L"clipboard") {
        const PasteOutcome outcome = pasteClipboardText(request.payload.text);

        if (outcome == PasteOutcome::Success) {
            logLine("[INJECT] handleRequest SUCCESS (clipboard)\n");
            fflush(stdout);
            saveTargetWindow();
            return makeResponse(true, "", "clipboard", requestId);
        }

        if (outcome == PasteOutcome::ClipboardBlocked) {
            // Clipboard paste was blocked by target – fall back to SendInput Unicode
            logLine("[INJECT] handleRequest FALLBACK: clipboard blocked, trying sendUnicodeText\n");
            fflush(stdout);

            if (request.payload.delayMs > 0) {
                std::this_thread::sleep_for(std::chrono::milliseconds(request.payload.delayMs));
            }

            if (sendUnicodeText(request.payload.text, request.payload.charDelayMs)) {
                logLine("[INJECT] handleRequest SUCCESS (sendinput fallback)\n");
                fflush(stdout);
                saveTargetWindow();
                return makeResponse(true, "", "sendinput", requestId);
            }

            logLine("[INJECT] handleRequest FAILED: SendInput Unicode fallback failed\n");
            fflush(stdout);
            return makeResponse(false, "SendInput Unicode fallback failed after clipboard was blocked", "", requestId);
        }

        logLine("[INJECT] handleRequest FAILED: clipboard paste failed\n");
        fflush(stdout);
        return makeResponse(false, "Clipboard write or paste failed", "", requestId);
    }

    if (request.payload.restorePreviousWindow && request.payload.delayMs > 0) {
        std::this_thread::sleep_for(std::chrono::milliseconds(request.payload.delayMs));
    }

    if (sendUnicodeText(request.payload.text, request.payload.charDelayMs)) {
        logLine("[INJECT] handleRequest SUCCESS (sendinput)\n");
        fflush(stdout);
        saveTargetWindow();
        return makeResponse(true, "", "sendinput", requestId);
    }

    logLine("[INJECT] handleRequest FAILED: SendInput failed\n");
    fflush(stdout);
    return makeResponse(false, "SendInput failed", "", requestId);
}

// ─── WebSocket client handler ───────────────────────────────────

void handleClient(SOCKET client) {
    try {
    logLine("[WS] handleClient NEW connection\n");
    fflush(stdout);

    if (!wsHandshake(client)) {
        logLine("[WS] handleClient handshake FAILED\n");
        fflush(stdout);
        closesocket(client);
        return;
    }

    logLine("[WS] handleClient handshake OK\n");
    fflush(stdout);

    // Add to client set for hotkey broadcasts
    {
        std::lock_guard<std::mutex> lock(g_clientsMutex);
        // Erlaube mehrere parallele Clients (z. B. HID-Native + Inject-Client).
        // Alte, getrennte Verbindungen werden ueber den recv-Loop natuerlich bereinigt.
        g_wsClients.insert(client);
    }

    while (g_serverRunning) {
        auto maybeFrame = recvWsFrame(client);
        if (!maybeFrame) break;

        uint8_t opcode = maybeFrame->opcode;

        // Close frame
        if (opcode == 0x8) break;

        // Ping → Pong
        if (opcode == 0x9) {
            sendWsFrame(client, 0xA, maybeFrame->payload);
            continue;
        }

        // Only handle text frames
        if (opcode != 0x1) continue;

        std::string& request = maybeFrame->payload;

        // Check if it's a control message
        NativeRequest nr;
        try {
            nr = parseRequest(request);
        } catch (const std::exception&) {
            sendWsFrame(client, 0x1, makeResponse(false, "Invalid request", ""));
            continue;
        }

        if (nr.type == L"listen-hotkeys") {
            // Hotkey listener is already started globally; just acknowledge
            sendWsFrame(client, 0x1, makeTypedResponse("hotkey-listener-ready", true, ""));
            continue;
        }

        if (nr.type == L"unlisten-hotkeys") {
            sendWsFrame(client, 0x1, makeTypedResponse("hotkey-listener-stopped", true, ""));
            continue;
        }

        if (nr.type == L"recording-status") {
            const bool active = getBoolValue(request, "active", false);
            const bool frontendVisible = getBoolValue(request, "frontendVisible", false);
            setRecordingState(active, L"websocket", !frontendVisible);
            sendWsFrame(client, 0x1, makeTypedResponse("recording-status-updated", true, ""));
            continue;
        }

        if (nr.type == L"set-target-window") {
            // Frontend-seitige Konfiguration des Ziel-Fensters.
            // Erlaubt dem Nutzer, Titel-Pattern und/oder Klassenname
            // für die Ziel-App festzulegen (z. B. "Radiologie" im Titel).
            const std::wstring windowTitle = getStringValue(request, "windowTitle");
            const std::wstring windowClass = getStringValue(request, "windowClass");
            const bool clear = getBoolValue(request, "clear", false);

            {
                std::lock_guard<std::mutex> lock(g_targetWindowMutex);
                if (clear) {
                    g_targetWindowTitlePattern.clear();
                    g_targetWindowClassName.clear();
                    g_targetWindow = nullptr;
                } else {
                    if (!windowTitle.empty()) g_targetWindowTitlePattern = windowTitle;
                    if (!windowClass.empty()) g_targetWindowClassName = windowClass;
                }
            }

            // Versuche sofort das Fenster zu finden und als Target zu setzen
            HWND found = findTargetWindowByPattern();
            if (found != nullptr) {
                std::lock_guard<std::mutex> lock(g_targetWindowMutex);
                g_targetWindow = found;
            }

            logLine("[WS] set-target-window title=\"%ls\" class=\"%ls\" clear=%d found=0x%p\n",
                   windowTitle.c_str(), windowClass.c_str(), clear ? 1 : 0, found);
            fflush(stdout);

            sendWsFrame(client, 0x1, makeTypedResponse("target-window-set", true, ""));
            continue;
        }

        if (nr.type == L"set-frontend-mode") {
            // Mitteilung vom Frontend, ob es sich im "Ziel-App"-Modus befindet.
            // Im Ziel-App-Modus zeigt der Injector das "REC"-Overlay bei HID-Record;
            // im Normal-Modus (oder wenn kein Frontend verbunden) unterdrückt er es.
            const std::wstring mode = getStringValue(request, "mode");
            g_frontendTargetMode.store(mode == L"target-app");
            logLine("[WS] set-frontend-mode mode=\"%ls\" → targetMode=%d\n",
                   mode.c_str(), g_frontendTargetMode.load());
            fflush(stdout);
            sendWsFrame(client, 0x1, makeTypedResponse("frontend-mode-set", true, ""));
            continue;
        }

        if (nr.type == L"start-hid") {
            hidDiagnostic("=== HID-Start angefordert vom Frontend ===");
            hidDiagnostic("HiddenWindow: hwnd=0x%p threadId=%lu", g_hiddenWnd, g_hiddenWndThreadId);
            hidDiagnostic("HID-Registrierung aktuell: %s", g_hidRawInputRegistered ? "aktiv" : "inaktiv");

            // Alle aktuell angeschlossenen Raw-Input-Geraete auflisten
            enumerateAllRawInputDevices();

            hidDiagnostic("Geraete bekannt: %zu", g_hidDevices.size());
            for (const auto& dev : g_hidDevices) {
                hidDiagnostic("  -> VID=0x%04X PID=0x%04X name=\"%ls\" pressed=%d",
                    dev.vendorId, dev.productId, dev.deviceName.c_str(), dev.recordPressed ? 1 : 0);
            }
            size_t clientCount = 0;
            {
                std::lock_guard<std::mutex> lock(g_clientsMutex);
                clientCount = g_wsClients.size();
            }
            hidDiagnostic("Clients verbunden: %zu (vor start-hid)", clientCount);

            registerHidRawInputDevices();

            hidDiagnostic("Nach registerHidRawInputDevices: %s",
                g_hidRawInputRegistered ? "ERFOLG" : "FEHLGESCHLAGEN");

            sendWsFrame(client, 0x1, makeTypedResponse("hid-listener-ready", g_hidRawInputRegistered,
                g_hidRawInputRegistered ? "" : "HID Raw Input registration failed"));
            // Sende zusaetzlich hid-status, damit der Frontend-Handshake
            // (hidNativeClient.ts) die HID-Bestaetigung erhaelt.
            // Das Frontend wartet nach start-hid auf type:"hid-status".
            const std::string statusMsg = makeHidStatusResponse();
            hidDiagnostic("WebSocket: sende hid-status: %s", statusMsg.c_str());
            sendWsFrame(client, 0x1, statusMsg);
            continue;
        }

        if (nr.type == L"stop-hid") {
            unregisterHidRawInputDevices();
            sendWsFrame(client, 0x1, makeTypedResponse("hid-listener-stopped", true, ""));
            continue;
        }

        if (nr.type == L"hid-status") {
            static DWORD lastHidStatusLog = 0;
            DWORD now = GetTickCount();
            if (now - lastHidStatusLog > 30000) {
                lastHidStatusLog = now;
                hidDiagnostic("hid-status abgefragt (Geraete bekannt: %zu)", g_hidDevices.size());
            }
            const std::string statusMsg = makeHidStatusResponse();
            sendWsFrame(client, 0x1, statusMsg);
            continue;
        }

        // Handle inject request
        std::string response = handleRequest(request);
        sendWsFrame(client, 0x1, response);
    }

    // Remove from client set
    {
        std::lock_guard<std::mutex> lock(g_clientsMutex);
        g_wsClients.erase(client);
    }
    // Frontend hat die Verbindung getrennt → Ziel-App-Modus zurücksetzen,
    // damit das REC-Overlay nicht mehr angezeigt wird.
    g_frontendTargetMode.store(false);
    closesocket(client);

    } catch (const std::exception& e) {
        logLine("[WS] handleClient CRASH (exception): %s\n", e.what());
        fflush(stdout);
        {
            std::lock_guard<std::mutex> lock(g_clientsMutex);
            g_wsClients.erase(client);
        }
        closesocket(client);
    } catch (...) {
        logLine("[WS] handleClient CRASH (unknown exception)\n");
        fflush(stdout);
        {
            std::lock_guard<std::mutex> lock(g_clientsMutex);
            g_wsClients.erase(client);
        }
        closesocket(client);
    }
}

// ─── WebSocket server thread ────────────────────────────────────

void wsServerThread() {
    SOCKET listenSock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listenSock == INVALID_SOCKET) return;

    int opt = 1;
    setsockopt(listenSock, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&opt), sizeof(opt));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(WS_PORT);
    inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);

    if (bind(listenSock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
        closesocket(listenSock);
        return;
    }

    if (listen(listenSock, SOMAXCONN) != 0) {
        closesocket(listenSock);
        return;
    }

    g_serverRunning = true;

    while (g_serverRunning) {
        fd_set readSet;
        FD_ZERO(&readSet);
        FD_SET(listenSock, &readSet);
        timeval tv{1, 0}; // 1-second timeout to check g_serverRunning

        int sel = select(0, &readSet, nullptr, nullptr, &tv);
        if (sel <= 0) continue;

        SOCKET client = accept(listenSock, nullptr, nullptr);
        if (client == INVALID_SOCKET) continue;

        // Set TCP_NODELAY for low latency on localhost
        int noDelay = 1;
        setsockopt(client, IPPROTO_TCP, TCP_NODELAY, reinterpret_cast<const char*>(&noDelay), sizeof(noDelay));

        // SO_SNDTIMEO verhindert, dass ein blockierter ::send()-Aufruf
        // im WebSocket-Handler (broadcastToClients) den gesamten
        // HiddenWindow-Message-Pump-Thread blockiert. Wenn der Browser-Tab
        // langsam rendert und den TCP-Puffer nicht rechtzeitig leert,
        // staute frueher der gesamte WM_INPUT-Queue – HID-Record-Events
        // erschienen bis zu 10 s verspaetet. Mit 200 ms Timeout wird der
        // Client stattdessen getrennt und das naechste WM_INPUT sofort
        // verarbeitet.
        DWORD sendTimeout = 200; // ms
        setsockopt(client, SOL_SOCKET, SO_SNDTIMEO,
                   reinterpret_cast<const char*>(&sendTimeout), sizeof(sendTimeout));

        std::thread(handleClient, client).detach();
    }

    closesocket(listenSock);
}

} // namespace

// ─── Singleton-Prüfung (außerhalb namespace) ─────────────────────

constexpr wchar_t SINGLETON_MUTEX_NAME[] = L"SchreibdienstInjector_Singleton_v1";

/**
 * Beendet alle laufenden Instanzen von schreibdienst-injector.exe
 * (außer dem aktuellen Prozess) und wartet bis sie terminiert sind.
 * Verhindert parallele Instanzen mit konkurrierenden WebSocket-Ports.
 */
void terminateOtherInjectorInstances() {
    const DWORD currentPid = GetCurrentProcessId();
    const HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return;

    PROCESSENTRY32W pe{};
    pe.dwSize = sizeof(pe);

    if (Process32FirstW(snapshot, &pe)) {
        do {
            if (pe.th32ProcessID == currentPid) continue;
            if (_wcsicmp(pe.szExeFile, L"schreibdienst-injector.exe") != 0) continue;

            const HANDLE hProcess = OpenProcess(
                PROCESS_TERMINATE | PROCESS_QUERY_INFORMATION | SYNCHRONIZE,
                FALSE,
                pe.th32ProcessID
            );
            if (hProcess == nullptr) continue;

            // Sanft beenden: WM_QUIT an verstecktes Fenster senden
            EnumWindows([](HWND hwnd, LPARAM lParam) -> BOOL {
                DWORD pid = 0;
                GetWindowThreadProcessId(hwnd, &pid);
                if (pid == static_cast<DWORD>(lParam)) {
                    wchar_t className[64] = {};
                    GetClassNameW(hwnd, className, static_cast<int>(std::size(className)));
                    if (wcscmp(className, L"SchreibdienstHiddenWnd") == 0) {
                        PostMessage(hwnd, WM_QUIT, 0, 0);
                    }
                }
                return TRUE;
            }, static_cast<LPARAM>(pe.th32ProcessID));

            // 3 Sekunden auf sauberes Beenden warten
            const DWORD waitResult = WaitForSingleObject(hProcess, 3000);
            if (waitResult != WAIT_OBJECT_0) {
                TerminateProcess(hProcess, 0);
            }

            CloseHandle(hProcess);
            logLine("[SINGLETON] Alte Injector-Instanz (PID=%lu) beendet\n",
                    static_cast<unsigned long>(pe.th32ProcessID));
        } while (Process32NextW(snapshot, &pe));
    }

    CloseHandle(snapshot);
}

/**
 * Prüft via Named Mutex, ob bereits eine Injector-Instanz läuft.
 * Falls ja: alte Instanz beenden, auf Freigabe warten, dann selbst starten.
 */
bool ensureSingleInjectorInstance(HANDLE& outMutex) {
    outMutex = CreateMutexW(nullptr, TRUE, SINGLETON_MUTEX_NAME);
    if (outMutex == nullptr) return false;

    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        logLine("[SINGLETON] Alte Instanz erkannt – wird beendet\n");
        fflush(stdout);

        // Mutex-Handle schliessen – die andere Instanz hält ihn noch
        CloseHandle(outMutex);
        outMutex = nullptr;

        terminateOtherInjectorInstances();

        // Warten bis die alte Instanz den Mutex freigegeben hat
        const HANDLE waitMutex = OpenMutexW(SYNCHRONIZE, FALSE, SINGLETON_MUTEX_NAME);
        if (waitMutex != nullptr) {
            WaitForSingleObject(waitMutex, 10000); // max 10s warten
            CloseHandle(waitMutex);
        }

        // Kurze Pause, dann neu versuchen
        Sleep(500);
        outMutex = CreateMutexW(nullptr, TRUE, SINGLETON_MUTEX_NAME);
        if (outMutex == nullptr) return false;
    }

    return true;
}

// ══════════════════════════════════════════════════════════════════
// WinMain – GUI-Entry-Point (kein Konsolenfenster)
// ══════════════════════════════════════════════════════════════════

struct StartupOptions {
    bool showConsole = false;
    bool showHelp = false;
};

StartupOptions parseStartupOptions(LPSTR lpCmdLine) {
    StartupOptions options;
    if (lpCmdLine == nullptr) return options;

    // Einfache Tokenisierung: Argumente durch Leerzeichen getrennt
    std::string cmd(lpCmdLine);
    std::vector<std::string> args;
    std::string current;
    bool inQuote = false;
    for (char c : cmd) {
        if (c == '"') { inQuote = !inQuote; continue; }
        if (c == ' ' && !inQuote) {
            if (!current.empty()) { args.push_back(current); current.clear(); }
            continue;
        }
        current.push_back(c);
    }
    if (!current.empty()) args.push_back(current);

    for (const auto& arg : args) {
        if (arg == "-show" || arg == "--show") {
            options.showConsole = true;
        } else if (arg == "-h" || arg == "--help" || arg == "/?") {
            options.showHelp = true;
        }
    }
    return options;
}

void printStartupHelp() {
    std::printf("Schreibdienst Injector\n");
    std::printf("Optionen:\n");
    std::printf("  -show, --show   Konsolenfenster mit Logging oeffnen\n");
    std::printf("  -h, --help      Diese Hilfe anzeigen\n");
    std::printf("Standardmaessig laeuft der Injector im Hintergrund ohne sichtbares Fenster.\n");
    std::printf("\nGlobale Hotkeys (auch mit Shift nutzbar):\n");
    std::printf("  F9 / Shift+F9   Aufnahme starten / stoppen\n");
    std::printf("  F10 / Shift+F10  Aufnahme stoppen\n");
    std::printf("  F11 / Shift+F11  Editor-Text in die Ziel-App uebertragen\n");
    std::printf("  Esc / Shift+Esc  Aufnahme abbrechen\n");
    std::printf("\nUnterstuetze Diktiermikrofone (automatisch):\n");
    std::printf("  Grundig SonicMic\n");
    std::printf("  Philips SpeechMike III\n");
}

int WINAPI WinMain(HINSTANCE /*hInstance*/, HINSTANCE /*hPrevInstance*/,
                   LPSTR lpCmdLine, int /*nShowCmd*/) {
    StartupOptions options = parseStartupOptions(lpCmdLine);
    SetCurrentProcessExplicitAppUserModelID(L"Schreibdienst.Injector");

    // Singleton: alte laufende Instanz beenden, dann selbst starten
    HANDLE singletonMutex = nullptr;
    if (!ensureSingleInjectorInstance(singletonMutex)) {
        // Konnte Mutex nicht anlegen (seltener Systemfehler) – trotzdem starten
    }

    if (options.showHelp) {
        // Hilfe soll immer sichtbar sein -> Console erzwingen.
        AllocConsole();
        FILE* dummy = nullptr;
        freopen_s(&dummy, "CONOUT$", "w", stdout);
        freopen_s(&dummy, "CONOUT$", "w", stderr);
        printStartupHelp();
        // Kurz offen lassen, damit der Benutzer die Ausgabe lesen kann.
        Sleep(2500);
        return 0;
    }

    if (options.showConsole) {
        g_loggingEnabled = true;
        // Optionales Konsolenfenster fuer Diagnose/Logging.
        AllocConsole();
        FILE* dummy = nullptr;
        freopen_s(&dummy, "CONOUT$", "w", stdout);
        freopen_s(&dummy, "CONOUT$", "w", stderr);
        std::printf("Schreibdienst Injector (Logging an)\n");
    }

    // Injector-Konfiguration laden (injector-config.json in %LOCALAPPDATA%\Schreibdienst)
    if (!options.showHelp) {
        initInjectorConfig();
    }

    // Initialize Winsock
    WSADATA wsaData;
    if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
        return 1;
    }

    // Start hidden message-only window for SendInput delegation.
    // SendInput(KEYEVENTF_UNICODE) requires a message queue on the
    // calling thread. The hidden window thread provides one.
    g_hiddenWndReady = CreateEvent(nullptr, TRUE, FALSE, nullptr);
    std::thread hiddenWndThread(hiddenWindowThread);
    WaitForSingleObject(g_hiddenWndReady, 5000);
    CloseHandle(g_hiddenWndReady);
    g_hiddenWndReady = nullptr;

    if (options.showConsole) {
        std::printf("Winsock initialisiert, starte Hotkey-Listener und WebSocket-Server...\n");
    }

    // Start global hotkey listener
    HotkeyListener hotkeyListener;
    std::string hotkeyError;
    startHotkeyListener(hotkeyListener, hotkeyError);
    // Hotkey error is non-fatal for server startup; the client will be
    // notified via 'hotkey-listener-ready' when it sends 'listen-hotkeys'.

    if (options.showConsole) {
        if (hotkeyError.empty()) {
            std::printf("Globale Hotkeys registriert: %u Varianten (F9/F10/F11/Esc, jeweils auch mit Shift)\n",
                        static_cast<unsigned>(sizeof(HOTKEY_BINDINGS) / sizeof(HOTKEY_BINDINGS[0])));
        } else {
            std::printf("Globale Hotkeys konnten nicht registriert werden: %s\n", hotkeyError.c_str());
        }
        std::printf("WebSocket-Server laeuft auf ws://127.0.0.1:%u\n", WS_PORT);
    }

    // Start WebSocket server on 127.0.0.1:58765
    std::thread serverThread(wsServerThread);

    // Wait for server thread (runs until process killed)
    serverThread.join();

    // Cleanup
    g_serverRunning = false;
    stopHotkeyListener(hotkeyListener);

    // Shut down hidden window thread
    removeTrayIcon();
    if (g_recordingOverlayWnd != nullptr) {
        DestroyWindow(g_recordingOverlayWnd);
        g_recordingOverlayWnd = nullptr;
    }
    if (g_hiddenWnd != nullptr) {
        PostMessage(g_hiddenWnd, WM_QUIT, 0, 0);
    }
    if (hiddenWndThread.joinable()) {
        hiddenWndThread.join();
    }

    // Close all remaining WebSocket clients
    {
        std::lock_guard<std::mutex> lock(g_clientsMutex);
        for (SOCKET s : g_wsClients) {
            closesocket(s);
        }
        g_wsClients.clear();
    }

    WSACleanup();

    // Singleton-Mutex freigeben
    if (singletonMutex != nullptr) {
        ReleaseMutex(singletonMutex);
        CloseHandle(singletonMutex);
    }

    return 0;
}



