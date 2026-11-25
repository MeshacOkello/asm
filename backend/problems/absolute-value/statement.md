Write the function `absValue`, which returns the absolute value of a signed 64-bit integer.

```c
long absValue(long n);
```

`n` arrives in `x0`. Return the result in `x0`, then `ret`. For `LONG_MIN`, which has no positive counterpart, return `LONG_MIN` unchanged.

## Examples

```
absValue(5)   returns 5
absValue(-7)  returns 7
absValue(0)   returns 0
```
