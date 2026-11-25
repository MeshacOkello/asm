// long stringLength(const char *s)
        .section .text
        .global stringLength
stringLength:
        mov     x1, x0          // x1 walks the string; x0 keeps its start
lengthLoop:
        ldrb    w2, [x1], 1     // w2 = *x1, then x1++
        cbnz    w2, lengthLoop  // until the NUL byte
        sub     x0, x1, x0      // bytes read, including the NUL
        sub     x0, x0, 1
        ret
