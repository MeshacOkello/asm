// Read n, then n integers, and print their sum.
        .section .rodata
scanFormat:
        .string "%ld"
printFormat:
        .string "%ld\n"

        .section .text
        .equ    MAIN_STACK_BYTECOUNT, 32
        .equ    VALUE, 8        // the long scanf reads into
        .equ    SAVED, 16       // x19 and x20
        .global main
main:
        sub     sp, sp, MAIN_STACK_BYTECOUNT
        str     x30, [sp]
        stp     x19, x20, [sp, SAVED]

        adr     x0, scanFormat
        add     x1, sp, VALUE
        bl      scanf           // scanf("%ld", &n)
        ldr     x19, [sp, VALUE] // x19 = numbers left to read
        mov     x20, 0          // x20 = sum
        cbz     x19, printSum
readLoop:
        adr     x0, scanFormat
        add     x1, sp, VALUE
        bl      scanf           // scanf("%ld", &value)
        ldr     x1, [sp, VALUE]
        add     x20, x20, x1
        subs    x19, x19, 1
        b.ne    readLoop
printSum:
        adr     x0, printFormat
        mov     x1, x20
        bl      printf          // printf("%ld\n", sum)

        ldp     x19, x20, [sp, SAVED]
        ldr     x30, [sp]
        add     sp, sp, MAIN_STACK_BYTECOUNT
        mov     w0, 0           // return 0
        ret
