Write the function `factorial` **recursively**: for `n` greater than 1 it calls itself with `n - 1` and multiplies the result by `n`.

```c
long factorial(long n) {
    if (n <= 1)
        return 1;
    return n * factorial(n - 1);
}
```

`n` arrives in `x0` and is between 0 and 20, so the result fits in a `long`. Return it in `x0`.

## Examples

```
factorial(0)  returns 1
factorial(1)  returns 1
factorial(5)  returns 120
```
