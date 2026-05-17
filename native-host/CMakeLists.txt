cmake_minimum_required(VERSION 3.21)

project(schreibdienst_injector LANGUAGES CXX)

add_executable(schreibdienst-injector src/main.cpp)
target_compile_features(schreibdienst-injector PRIVATE cxx_std_17)
target_link_libraries(schreibdienst-injector PRIVATE user32)

if (MSVC)
  target_compile_options(schreibdienst-injector PRIVATE /W4 /permissive-)
endif()