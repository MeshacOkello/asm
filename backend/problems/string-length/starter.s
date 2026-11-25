// long stringLength(const char *s)
// s arrives in x0. Return the number of bytes before the NUL byte in x0.
        .section .text
        .global stringLength
stringLength:
        // Your code here
        mov     x0, 0
        ret
