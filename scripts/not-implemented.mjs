// Placeholder that fails loudly so an unfinished script can never look like a pass.
const [name = 'script', milestone = 'a later milestone'] = process.argv.slice(2);
console.error(`${name} is not implemented yet (planned in ${milestone}). Failing on purpose.`);
process.exit(1);
