// long arrayMax(long *arr, long n)
        .section .text
        .global arrayMax
arrayMax:
        ldr     x2, [x0], 8     // max = arr[0], move to arr[1]
        subs    x1, x1, 1       // elements left after the first
        b.eq    maxDone
maxLoop:
        ldr     x3, [x0], 8     // x3 = next element
        cmp     x3, x2
        csel    x2, x3, x2, gt  // max = x3 > max ? x3 : max
        subs    x1, x1, 1
        b.ne    maxLoop
maxDone:
        mov     x0, x2
        ret
