// Read n, then n integers, and print their sum.
        .section .rodata
scanFormat:
        .string "%ld"
printFormat:
        .string "%ld\n"

        .section .text
        .global main
main:
        // Your code here
        mov     w0, 0           // return 0
        ret
