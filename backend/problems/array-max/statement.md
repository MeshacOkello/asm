Write the function `arrayMax`, which returns the largest element of an array of signed 64-bit `long`s.

```c
long arrayMax(long *arr, long n);
```

`arr` arrives in `x0`: the address of the first element. `n`, the number of elements, arrives in `x1` and is at least 1. Each element is 8 bytes. Return the maximum in `x0`.

## Examples

```
arrayMax([3, 1, 4, 1, 5], 5)  returns 5
arrayMax([-3, -1, -7], 3)     returns -1
arrayMax([42], 1)             returns 42
```
