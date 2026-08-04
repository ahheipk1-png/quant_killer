cmake_minimum_required(VERSION 3.20)
project(quantkiller LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Header-only core (qkmath, rng, models/*) -- see include/quantkiller/.
add_library(quantkiller_core INTERFACE)
target_include_directories(quantkiller_core INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/include)

add_executable(quantkiller src/cli/main.cpp)
target_link_libraries(quantkiller PRIVATE quantkiller_core)

enable_testing()
add_executable(quantkiller_vector_tests tests/vector_tests.cpp)
target_link_libraries(quantkiller_vector_tests PRIVATE quantkiller_core)
add_test(NAME vector_tests COMMAND quantkiller_vector_tests
         WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR})
