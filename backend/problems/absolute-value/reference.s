// long absValue(long n)
        .section .text
        .global absValue
absValue:
        cmp     x0, 0
        cneg    x0, x0, lt      // negate when n < 0
        ret
