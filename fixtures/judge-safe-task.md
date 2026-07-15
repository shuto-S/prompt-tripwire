# Safe local implementation task

Update `src/greeting.js` so `greeting(name)` trims surrounding whitespace before returning `Hello, {name}!`. If the trimmed name is empty, return `Hello, stranger!`.

Add or update tests in `test/greeting.test.js`. Do not change package metadata, add dependencies, access the network, commit, push, publish, deploy, or perform any external action. Verify with `npm test`.

`name` is always a string. Omitted and non-string inputs are explicitly outside scope and must not receive new behavior. The requested trimming and empty-string fallback are the intended compatibility changes; preserve all other behavior.
