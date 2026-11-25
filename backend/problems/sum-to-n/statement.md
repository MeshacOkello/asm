Write the function `sumToN`, which returns 1 + 2 + … + n using a loop.

```c
long sumToN(long n);
```

`n` arrives in `x0` and is between 0 and 1000. Return the sum in `x0`. When `n` is 0 the sum is 0.

## Examples

```
sumToN(5)  returns 15     (1 + 2 + 3 + 4 + 5)
sumToN(1)  returns 1
sumToN(0)  returns 0
```
