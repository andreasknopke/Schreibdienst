#define NOMINMAX
#include <windows.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <fcntl.h>
#include <io.h>
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {

struct InjectPayload {
    std::wstring text;
    std::wstring mode = L"sendinput";
    bool restorePreviousWindow = true;
    std::uint32_t delayMs = 120;
};

struct NativeRequest {
    std::wstring type;
    InjectPayload payload;
};

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
    request.payload.text = getStringValue(json, "text");
    request.payload.mode = getStringValue(json, "mode", L"sendinput");
    request.payload.restorePreviousWindow = getBoolValue(json, "restorePreviousWindow", true);
    request.payload.delayMs = getUIntValue(json, "delayMs", 120);
    return request;
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

std::string makeResponse(bool ok, const std::string& error = "", const std::string& mode = "sendinput") {
    std::string response = "{\"ok\":";
    response += ok ? "true" : "false";
    if (!mode.empty()) {
        response += ",\"mode\":\"" + jsonEscape(mode) + "\"";
    }
    if (!error.empty()) {
        response += ",\"error\":\"" + jsonEscape(error) + "\"";
    }
    response += "}";
    return response;
}

bool readExact(void* target, std::size_t size) {
    return std::fread(target, 1, size, stdin) == size;
}

std::optional<std::string> readNativeMessage() {
    std::uint32_t length = 0;
    if (!readExact(&length, sizeof(length))) {
        return std::nullopt;
    }

    if (length == 0 || length > 1024 * 1024) {
        return std::nullopt;
    }

    std::string message(length, '\0');
    if (!readExact(message.data(), length)) {
        return std::nullopt;
    }
    return message;
}

bool writeNativeMessage(const std::string& message) {
    const auto length = static_cast<std::uint32_t>(message.size());
    return std::fwrite(&length, 1, sizeof(length), stdout) == sizeof(length)
        && std::fwrite(message.data(), 1, message.size(), stdout) == message.size()
        && std::fflush(stdout) == 0;
}

bool sendInputs(const std::vector<INPUT>& inputs) {
    constexpr std::size_t chunkSize = 2048;
    std::size_t offset = 0;
    while (offset < inputs.size()) {
        const std::size_t count = std::min(chunkSize, inputs.size() - offset);
        const UINT sent = SendInput(static_cast<UINT>(count), const_cast<INPUT*>(&inputs[offset]), sizeof(INPUT));
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

bool sendUnicodeText(const std::wstring& text) {
    std::vector<INPUT> inputs;
    inputs.reserve(text.size() * 2);

    for (const wchar_t unit : text) {
        inputs.push_back(makeUnicodeInput(unit, false));
        inputs.push_back(makeUnicodeInput(unit, true));
    }

    return sendInputs(inputs);
}

std::string handleRequest(const std::string& message) {
    NativeRequest request;
    try {
        request = parseRequest(message);
    } catch (const std::exception& error) {
        return makeResponse(false, std::string("Invalid request: ") + error.what(), "");
    }

    if (request.type != L"inject-text") {
        return makeResponse(false, "Unknown message type", "");
    }
    if (request.payload.text.empty()) {
        return makeResponse(false, "No text to inject", "");
    }

    if (request.payload.restorePreviousWindow && !activatePreviousWindow(request.payload.delayMs)) {
        return makeResponse(false, "Alt-Tab focus handover failed", "");
    }

    if (request.payload.delayMs > 0) {
        std::this_thread::sleep_for(std::chrono::milliseconds(request.payload.delayMs));
    }

    if (!sendUnicodeText(request.payload.text)) {
        return makeResponse(false, "SendInput failed", "");
    }

    return makeResponse(true, "", request.payload.mode == L"uia" ? "sendinput-uia-fallback" : "sendinput");
}

} // namespace

int main() {
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);

    while (const auto message = readNativeMessage()) {
        if (!writeNativeMessage(handleRequest(*message))) {
            return 1;
        }
    }

    return 0;
}