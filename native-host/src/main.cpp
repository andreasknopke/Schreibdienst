#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <roapi.h>
#include <propkey.h>
#include <propvarutil.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <windows.data.xml.dom.h>
#include <windows.ui.notifications.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <wrl.h>
#include <wrl/wrappers/corewrappers.h>

#include <cstdio>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
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
constexpr wchar_t SCHREIBDIENST_TOAST_APP_ID[] = L"Schreibdienst.Injector";
constexpr wchar_t SCHREIBDIENST_TOAST_SHORTCUT_NAME[] = L"Schreibdienst Injector.lnk";

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
    std::wstring mode = L"sendinput";
    bool restorePreviousWindow = true;
    std::uint32_t delayMs = 120;
    std::uint32_t charDelayMs = 2;
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

bool ensureToastShortcutRegistered() {
    PWSTR programsPathRaw = nullptr;
    const HRESULT folderHr = SHGetKnownFolderPath(FOLDERID_Programs, KF_FLAG_CREATE, nullptr, &programsPathRaw);
    if (FAILED(folderHr) || programsPathRaw == nullptr) {
        return false;
    }

    std::wstring shortcutPath(programsPathRaw);
    CoTaskMemFree(programsPathRaw);
    shortcutPath += L"\\";
    shortcutPath += SCHREIBDIENST_TOAST_SHORTCUT_NAME;

    const HRESULT coInitHr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

    Microsoft::WRL::ComPtr<IShellLinkW> shellLink;
    const HRESULT createHr = CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&shellLink));
    if (FAILED(createHr)) {
        if (SUCCEEDED(coInitHr)) {
            CoUninitialize();
        }
        return false;
    }

    const std::wstring executablePath = getExecutablePath();
    const std::wstring workingDirectory = getExecutableDirectory();
    shellLink->SetPath(executablePath.c_str());
    shellLink->SetWorkingDirectory(workingDirectory.c_str());
    shellLink->SetDescription(L"Schreibdienst Injector");

    Microsoft::WRL::ComPtr<IPropertyStore> propertyStore;
    if (SUCCEEDED(shellLink.As(&propertyStore))) {
        PROPVARIANT appIdVariant;
        PropVariantInit(&appIdVariant);
        if (SUCCEEDED(InitPropVariantFromString(SCHREIBDIENST_TOAST_APP_ID, &appIdVariant))) {
            propertyStore->SetValue(PKEY_AppUserModel_ID, appIdVariant);
            propertyStore->Commit();
            PropVariantClear(&appIdVariant);
        }
    }

    Microsoft::WRL::ComPtr<IPersistFile> persistFile;
    const HRESULT saveHr = shellLink.As(&persistFile);
    const bool saved = SUCCEEDED(saveHr) && SUCCEEDED(persistFile->Save(shortcutPath.c_str(), TRUE));

    if (SUCCEEDED(coInitHr)) {
        CoUninitialize();
    }

    return saved;
}

bool showModernRecordingToast(bool active) {
    using ABI::Windows::Data::Xml::Dom::IXmlDocument;
    using ABI::Windows::Data::Xml::Dom::IXmlDocumentIO;
    using ABI::Windows::UI::Notifications::IToastNotification;
    using ABI::Windows::UI::Notifications::IToastNotificationFactory;
    using ABI::Windows::UI::Notifications::IToastNotificationManagerStatics;
    using ABI::Windows::UI::Notifications::IToastNotifier;
    using Microsoft::WRL::ComPtr;
    using Microsoft::WRL::Wrappers::HStringReference;

    if (!ensureToastShortcutRegistered()) {
        return false;
    }

    const HRESULT roInitHr = RoInitialize(RO_INIT_MULTITHREADED);
    if (FAILED(roInitHr) && roInitHr != RPC_E_CHANGED_MODE) {
        return false;
    }

    ComPtr<IToastNotificationManagerStatics> toastManager;
    HRESULT hr = RoGetActivationFactory(
        HStringReference(RuntimeClass_Windows_UI_Notifications_ToastNotificationManager).Get(),
        IID_PPV_ARGS(&toastManager)
    );
    if (FAILED(hr)) {
        if (SUCCEEDED(roInitHr)) {
            RoUninitialize();
        }
        return false;
    }

    ComPtr<IToastNotifier> notifier;
    hr = toastManager->CreateToastNotifierWithId(HStringReference(SCHREIBDIENST_TOAST_APP_ID).Get(), &notifier);
    if (FAILED(hr)) {
        if (SUCCEEDED(roInitHr)) {
            RoUninitialize();
        }
        return false;
    }

    std::wstring xml = LR"(<toast duration="short"><visual><binding template="ToastGeneric"><text>Schreibdienst</text><text>)";
    xml += active ? L"Aufnahme aktiv" : L"Aufnahme beendet";
    xml += LR"(</text></binding></visual><audio src="ms-winsoundevent:Notification.Default"/></toast>)";

    ComPtr<IInspectable> xmlDocumentInspectable;
    hr = RoActivateInstance(
        HStringReference(RuntimeClass_Windows_Data_Xml_Dom_XmlDocument).Get(),
        &xmlDocumentInspectable
    );
    if (FAILED(hr)) {
        if (SUCCEEDED(roInitHr)) {
            RoUninitialize();
        }
        return false;
    }

    ComPtr<IXmlDocument> xmlDocument;
    hr = xmlDocumentInspectable.As(&xmlDocument);
    if (FAILED(hr)) {
        if (SUCCEEDED(roInitHr)) {
            RoUninitialize();
        }
        return false;
    }

    ComPtr<IXmlDocumentIO> xmlDocumentIo;
    hr = xmlDocument.As(&xmlDocumentIo);
    if (FAILED(hr)) {
        if (SUCCEEDED(roInitHr)) {
            RoUninitialize();
        }
        return false;
    }

    hr = xmlDocumentIo->LoadXml(HStringReference(xml.c_str()).Get());
    if (FAILED(hr)) {
        if (SUCCEEDED(roInitHr)) {
            RoUninitialize();
        }
        return false;
    }

    ComPtr<IToastNotificationFactory> toastFactory;
    hr = RoGetActivationFactory(
        HStringReference(RuntimeClass_Windows_UI_Notifications_ToastNotification).Get(),
        IID_PPV_ARGS(&toastFactory)
    );
    if (FAILED(hr)) {
        if (SUCCEEDED(roInitHr)) {
            RoUninitialize();
        }
        return false;
    }

    ComPtr<IToastNotification> toastNotification;
    hr = toastFactory->CreateToastNotification(xmlDocument.Get(), &toastNotification);
    if (FAILED(hr)) {
        if (SUCCEEDED(roInitHr)) {
            RoUninitialize();
        }
        return false;
    }

    hr = notifier->Show(toastNotification.Get());
    if (SUCCEEDED(roInitHr)) {
        RoUninitialize();
    }

    return SUCCEEDED(hr);
}

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

    if (showModernRecordingToast(active)) {
        logLine("[TOAST] recording=%d source=%ls\n", active ? 1 : 0, source);
        return;
    }

    NOTIFYICONDATAW nid{};
    nid.cbSize = sizeof(nid);
    nid.hWnd = g_hiddenWnd;
    nid.uID = SCHREIBDIENST_TRAY_ICON_ID;
    nid.uFlags = NIF_INFO;
#ifdef NIF_REALTIME
    nid.uFlags |= NIF_REALTIME;
#endif
    nid.dwInfoFlags = active ? NIIF_INFO : NIIF_NONE;
    nid.uTimeout = 2000;

    if (active) {
        wcscpy_s(nid.szInfoTitle, L"Schreibdienst");
        wcscpy_s(nid.szInfo, L"Aufnahme aktiv");
    } else {
        wcscpy_s(nid.szInfoTitle, L"Schreibdienst");
        wcscpy_s(nid.szInfo, L"Aufnahme beendet");
    }

    Shell_NotifyIconW(NIM_MODIFY, &nid);
    MessageBeep(active ? MB_ICONASTERISK : MB_OK);
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

LRESULT CALLBACK HiddenWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
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
    // Register a window class for the hidden window
    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = HiddenWndProc;
    wc.hInstance = GetModuleHandle(nullptr);
    wc.lpszClassName = L"SchreibdienstHiddenWnd";
    if (!RegisterClassExW(&wc)) {
        // Class may already be registered from a previous run
    }

    g_hiddenWnd = CreateWindowExW(0, L"SchreibdienstHiddenWnd",
                                   L"", 0, 0, 0, 0, 0,
                                   HWND_MESSAGE, nullptr,
                                   GetModuleHandle(nullptr), nullptr);
    g_hiddenWndThreadId = GetCurrentThreadId();

    // Signal that the window is ready
    SetEvent(g_hiddenWndReady);

    // Message pump
    MSG msg;
    while (GetMessage(&msg, nullptr, 0, 0) > 0) {
        DispatchMessage(&msg);
    }
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
    request.payload.mode = getStringValue(json, "mode", L"sendinput");
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

std::string makeResponse(bool ok, const std::string& error = "", const std::string& mode = "sendinput", const std::string& requestId = "") {
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
        logLine("[INJECT] pasteClipboardText FAILED: writeClipboardText\n");
        fflush(stdout);
        return PasteOutcome::Failed;
    }

    // Kurz warten, bis die Zwischenablage aktualisiert ist
    std::this_thread::sleep_for(std::chrono::milliseconds(CLIPBOARD_READY_DELAY_MS));

    // 3) Ctrl+V senden
    if (!sendPasteShortcut()) {
        logLine("[INJECT] pasteClipboardText FAILED: sendPasteShortcut\n");
        fflush(stdout);
        restoreClipboardText(snapshot);
        return PasteOutcome::Failed;
    }

    // Kurz warten, damit die Ziel-App den Paste-Vorgang abschließen kann
    std::this_thread::sleep_for(std::chrono::milliseconds(CLIPBOARD_RESTORE_DELAY_MS));

    // 4) Ursprüngliche Zwischenablage wiederherstellen
    if (!restoreClipboardText(snapshot)) {
        logLine("[INJECT] pasteClipboardText WARNING: clipboard restore failed\n");
        fflush(stdout);
        // Nicht fatal – Text wurde bereits eingefügt
    }

    logLine("[INJECT] pasteClipboardText SUCCESS\n");
    fflush(stdout);
    return PasteOutcome::Success;
}

bool activatePreviousWindow(std::uint32_t delayMs) {
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
    // hat. Wenn unmittelbar danach der nächste Chunk geschickt wird, kann
    // eine langsame Ziel-App (KIS, alte Textverarbeitung) Events
    // "verschlucken". ~1.5ms pro Zeichen reicht in der Praxis aus, ohne
    // die Übertragung spürbar auszubremsen.
    if (ok && !text.empty()) {
        const auto settleMs = static_cast<DWORD>(std::min<size_t>(text.size() * 2, 80));
        std::this_thread::sleep_for(std::chrono::milliseconds(settleMs));
    }

    return ok;
}

// ─── Request handler ────────────────────────────────────────────

std::string handleRequest(const std::string& message) {
    NativeRequest request;
    try {
        request = parseRequest(message);
    } catch (const std::exception& error) {
        return makeResponse(false, std::string("Invalid request: ") + error.what(), "");
    }

    const std::string requestId = asciiFromWide(request.requestId);

    if (request.type != L"inject-text") {
        return makeResponse(false, "Unknown message type", "", requestId);
    }
    if (request.payload.text.empty()) {
        return makeResponse(false, "No text to inject", "", requestId);
    }

    std::lock_guard<std::mutex> injectLock(g_injectMutex);

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

    if (request.payload.mode != L"clipboard" && request.payload.delayMs > 0) {
        std::this_thread::sleep_for(std::chrono::milliseconds(request.payload.delayMs));
    }

    if (request.payload.mode == L"clipboard") {
        const PasteOutcome outcome = pasteClipboardText(request.payload.text);

        if (outcome == PasteOutcome::Success) {
            logLine("[INJECT] handleRequest SUCCESS (clipboard)\n");
            fflush(stdout);
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
        return makeResponse(true, "", "sendinput", requestId);
    }

    logLine("[INJECT] handleRequest FAILED: SendInput failed\n");
    fflush(stdout);
    return makeResponse(false, "SendInput failed", "", requestId);
}

// ─── WebSocket client handler ───────────────────────────────────

void handleClient(SOCKET client) {
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
        // Only keep the newest client to avoid stale connections
        for (SOCKET old : g_wsClients) {
            closesocket(old);
        }
        g_wsClients.clear();
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

        // Handle inject request
        std::string response = handleRequest(request);
        sendWsFrame(client, 0x1, response);
    }

    // Remove from client set
    {
        std::lock_guard<std::mutex> lock(g_clientsMutex);
        g_wsClients.erase(client);
    }
    closesocket(client);
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

        std::thread(handleClient, client).detach();
    }

    closesocket(listenSock);
}

} // namespace

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
}

int WINAPI WinMain(HINSTANCE /*hInstance*/, HINSTANCE /*hPrevInstance*/,
                   LPSTR lpCmdLine, int /*nShowCmd*/) {
    StartupOptions options = parseStartupOptions(lpCmdLine);
    SetCurrentProcessExplicitAppUserModelID(SCHREIBDIENST_TOAST_APP_ID);

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
    return 0;
}



