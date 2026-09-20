import fs from 'node:fs'
const s = fs.readFileSync('src/workspace/boundary.ts', 'utf8')
const bt = String.fromCharCode(96)
let count = 0
for (let i = 0; i < s.length; i++) {
  if (s[i] === bt) {
    count++
    console.log('backtick at offset', i, 'line', s.slice(0, i).split('\n').length, JSON.stringify(s.slice(Math.max(0, i - 30), i + 10)))
  }
}
console.log('total backticks:', count)
