Write the function `stringLength`, which returns the number of bytes in a C string before its terminating NUL byte, as `strlen` does. Do not call `strlen`: the simulator does not provide it.

```c
long stringLength(const char *s);
```

`s` arrives in `x0`: the address of the first character. The string ends at the first byte equal to 0. Return its length in `x0`.

## Examples

```
stringLength("hello")  returns 5
stringLength("")       returns 0
stringLength("a b c")  returns 5
```
