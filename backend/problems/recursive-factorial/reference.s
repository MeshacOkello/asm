// long factorial(long n)
        .section .text
        .equ    FACT_STACK_BYTECOUNT, 16
        .global factorial
factorial:
        cmp     x0, 1
        b.le    factBase        // n <= 1: a leaf call needs no frame

        // Save n and the return address together in one 16-byte frame.
        stp     x0, x30, [sp, -FACT_STACK_BYTECOUNT]!
        sub     x0, x0, 1
        bl      factorial       // x0 = factorial(n - 1)
        ldp     x1, x30, [sp], FACT_STACK_BYTECOUNT
        mul     x0, x0, x1      // x0 = n * factorial(n - 1)
        ret
factBase:
        mov     x0, 1
        ret
