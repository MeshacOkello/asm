// long factorial(long n)
// n arrives in x0. Return n! in x0, computed recursively.
        .section .text
        .global factorial
factorial:
        // Your code here
        mov     x0, 1
        ret
