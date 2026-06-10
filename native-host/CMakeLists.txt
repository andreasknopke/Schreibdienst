cmake_minimum_required(VERSION 3.21)

project(schreibdienst_injector LANGUAGES CXX)

add_executable(schreibdienst-injector src/main.cpp)
target_compile_features(schreibdienst-injector PRIVATE cxx_std_17)
target_link_libraries(schreibdienst-injector PRIVATE user32 ws2_32 shell32)

# MinGW-Runtime statisch linken, damit keine extra DLLs benötigt werden
if (MINGW)
    target_link_options(schreibdienst-injector PRIVATE -static-libgcc -static-libstdc++ -static)
endif()

# GUI-Subsystem: kein Konsolenfenster beim Doppelklick
set_target_properties(schreibdienst-injector PROPERTIES WIN32_EXECUTABLE TRUE)

if (MSVC)
  target_link_libraries(schreibdienst-injector PRIVATE runtimeobject)
  target_compile_options(schreibdienst-injector PRIVATE /W4 /permissive-)
endif()