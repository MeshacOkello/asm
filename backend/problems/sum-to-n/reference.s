// long sumToN(long n)
        .section .text
        .global sumToN
sumToN:
        mov     x1, 0           // sum = 0
        cbz     x0, sumDone     // n == 0: nothing to add
sumLoop:
        add     x1, x1, x0      // sum += n
        subs    x0, x0, 1       // n--, and set Z when it reaches 0
        b.ne    sumLoop
sumDone:
        mov     x0, x1
        ret
