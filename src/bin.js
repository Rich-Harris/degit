import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import mri from 'mri';
import degit from 'degit';

const args = mri(process.argv.slice(2), {
	alias: {
		f: 'force',
		m: 'force-merge',
		c: 'cache',
		v: 'verbose'
	},
	boolean: ['force', 'force-merge', 'cache', 'verbose']
});

const [src, dest = '.'] = args._;

if (args.help || !src) {
	const help = fs.readFileSync(path.join(__dirname, 'help.md'), 'utf-8')
		.replace(/^(\s*)#+ (.+)/gm, (m, s, _) => s + chalk.bold(_))
		.replace(/_([^_]+)_/g, (m, _) => chalk.underline(_))
		.replace(/`([^`]+)`/g, (m, _) => chalk.cyan(_));

	process.stdout.write(`\n${help}\n`);
} else {
	const d = degit(src, args);

	d.on('info', event => {
		console.error(chalk.cyan(`> ${event.message.replace('options.', '--')}`));
	});

	d.on('warn', event => {
		console.error(chalk.magenta(`! ${event.message.replace('options.', '--')}`));
	});

	d.clone(dest)
		// .then(() => {

		// })
		.catch(err => {
			console.error(chalk.red(`! ${err.message}`));
			process.exit(1);
		});
}
