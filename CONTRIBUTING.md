<!-- omit in toc -->

# Contributing to degit

First off, thanks for taking the time to contribute! ❤️

All types of contributions are encouraged and valued. See the [Table of Contents](#table-of-contents) for different ways to help and details about how this project handles them. Please make sure to read the relevant section before making your contribution. It will make it a lot easier for us maintainers and smooth out the experience for all involved. The community looks forward to your contributions. 🎉

> And if you like the project, but just don't have time to contribute, that's fine. There are other easy ways to support the project and show your appreciation, which we would also be very happy about:
>
> - Star the project
> - Tweet about it
> - Refer this project in your project's readme
> - Mention the project at local meetups and tell your friends/colleagues

<!-- omit in toc -->

## Table of Contents

- [I Have a Question](#i-have-a-question)
    - [I Want To Contribute](#i-want-to-contribute)
    - [Reporting Bugs](#reporting-bugs)
    - [Suggesting Enhancements](#suggesting-enhancements)
    - [Your First Code Contribution](#your-first-code-contribution)
    - [Improving The Documentation](#improving-the-documentation)
- [Styleguides](#styleguides)
    - [Commit Messages](#commit-messages)
- [Join The Project Team](#join-the-project-team)

## I Have a Question

> If you want to ask a question, we assume that you have read the available [Documentation](https://github.com/Rich-Harris/degit/blob/master/README.md).

Before you ask a question, it is best to search for existing [Issues](https://github.com/Rich-Harris/degit/issues) that might help you. In case you have found a suitable issue and still need clarification, you can write your question in this issue. It is also advisable to search the internet for answers first.

If you then still feel the need to ask a question and need clarification, we recommend the following:

- Open an [Issue](https://github.com/Rich-Harris/degit/issues/new).
- Provide as much context as you can about what you're running into.
- Provide project and platform versions (nodejs, npm, etc), depending on what seems relevant.

We will then take care of the issue as soon as possible.

<!--
You might want to create a separate issue tag for questions and include it in this description. People should then tag their issues accordingly.

Depending on how large the project is, you may want to outsource the questioning, e.g. to Stack Overflow or Gitter. You may add additional contact and information possibilities:
- IRC
- Slack
- Gitter
- Stack Overflow tag
- Blog
- FAQ
- Roadmap
- E-Mail List
- Forum
-->

## I Want To Contribute

> ### Legal Notice <!-- omit in toc -->
>
> When contributing to this project, you must agree that you have authored 100% of the content, that you have the necessary rights to the content and that the content you contribute may be provided under the project licence.

### Reporting Bugs

<!-- omit in toc -->

#### Before Submitting a Bug Report

A good bug report shouldn't leave others needing to chase you up for more information. Therefore, we ask you to investigate carefully, collect information and describe the issue in detail in your report. Please complete the following steps in advance to help us fix any potential bug as fast as possible.

- Make sure that you are using the latest version.
- Determine if your bug is really a bug and not an error on your side e.g. using incompatible environment components/versions (Make sure that you have read the [documentation](https://github.com/Rich-Harris/degit/blob/master/README.md). If you are looking for support, you might want to check [this section](#i-have-a-question)).
- To see if other users have experienced (and potentially already solved) the same issue you are having, check if there is not already a bug report existing for your bug or error in the [bug tracker](https://github.com/Rich-Harris/degit/issues?q=label%3Abug).
- Also make sure to search the internet (including Stack Overflow) to see if users outside of the GitHub community have discussed the issue.
- Collect information about the bug:
    - Stack trace (Traceback)
    - OS, Platform and Version (Windows, Linux, macOS, x86, ARM)
    - Version of the interpreter, compiler, SDK, runtime environment, package manager, depending on what seems relevant.
    - Possibly your input and the output
    - Can you reliably reproduce the issue? And can you also reproduce it with older versions?

<!-- omit in toc -->

#### How Do I Submit a Good Bug Report?

> Security issues are handled privately. Please see [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

<!-- You may add a PGP key to allow the messages to be sent encrypted as well. -->

We use GitHub issues to track bugs and errors. If you run into an issue with the project:

- Open an [Issue](https://github.com/Rich-Harris/degit/issues/new). (Since we can't be sure at this point whether it is a bug or not, we ask you not to talk about a bug yet and not to label the issue.)
- Explain the behavior you would expect and the actual behavior.
- Please provide as much context as possible and describe the _reproduction steps_ that someone else can follow to recreate the issue on their own. This usually includes your code. For good bug reports you should isolate the problem and create a reduced test case.
- Provide the information you collected in the previous section.

Once it's filed:

- The project team will label the issue accordingly.
- A team member will try to reproduce the issue with your provided steps. If there are no reproduction steps or no obvious way to reproduce the issue, the team will ask you for those steps and mark the issue as `needs-repro`. Bugs with the `needs-repro` tag will not be addressed until they are reproduced.
- If the team is able to reproduce the issue, it will be marked `needs-fix`, as well as possibly other tags (such as `critical`), and the issue will be left to be [implemented by someone](#your-first-code-contribution).

<!-- You might want to create an issue template for bugs and errors that can be used as a guide and that defines the structure of the information to be included. If you do so, reference it here in the description. -->

### Suggesting Enhancements

This section guides you through submitting an enhancement suggestion for degit, **including completely new features and minor improvements to existing functionality**. Following these guidelines will help maintainers and the community to understand your suggestion and find related suggestions.

<!-- omit in toc -->

#### Before Submitting an Enhancement

- Make sure that you are using the latest version.
- Read the [documentation](https://github.com/Rich-Harris/degit/blob/master/README.md) carefully and find out if the functionality is already covered, maybe by an individual configuration.
- Perform a [search](https://github.com/Rich-Harris/degit/issues) to see if the enhancement has already been suggested. If it has, add a comment to the existing issue instead of opening a new one.
- Find out whether your idea fits with the scope and aims of the project. It's up to you to make a strong case to convince the project's developers of the merits of this feature. Keep in mind that we want features that will be useful to the majority of our users and not just a small subset. If you're just targeting a minority of users, consider writing an add-on/plugin library.

<!-- omit in toc -->

#### How Do I Submit a Good Enhancement Suggestion?

Enhancement suggestions are tracked as [GitHub issues](https://github.com/Rich-Harris/degit/issues).

- Use a **clear and descriptive title** for the issue to identify the suggestion.
- Provide a **step-by-step description of the suggested enhancement** in as many details as possible.
- **Describe the current behavior** and **explain which behavior you expected to see instead** and why. At this point you can also tell which alternatives do not work for you.
- You may want to **include screenshots or screen recordings** which help you demonstrate the steps or point out the part which the suggestion is related to. You can use [LICEcap](https://www.cockos.com/licecap/) to record GIFs on macOS and Windows, and the built-in [screen recorder in GNOME](https://help.gnome.org/users/gnome-help/stable/screen-shot-record.html.en) or [SimpleScreenRecorder](https://github.com/MaartenBaert/ssr) on Linux. <!-- this should only be included if the project has a GUI -->
- **Explain why this enhancement would be useful** to most degit users. You may also want to point out the other projects that solved it better and which could serve as inspiration.

<!-- You might want to create an issue template for enhancement suggestions that can be used as a guide and that defines the structure of the information to be included. If you do so, reference it here in the description. -->

### Your First Code Contribution

Prerequisites:

- Node.js **20** or later (see `engines` in `package.json`)
- [Bun](https://bun.sh) **1.3.14** (same version as CI; see [.github/workflows/quality.yml](.github/workflows/quality.yml), [.github/workflows/verification.yml](.github/workflows/verification.yml), [.github/workflows/security.yml](.github/workflows/security.yml), and [.github/workflows/integration.yml](.github/workflows/integration.yml))

Clone the repository, install dependencies, and build:

```bash
git clone https://github.com/Rich-Harris/degit.git
cd degit
bun install
bun run build
```

Before opening a pull request, run the same checks CI runs:

```bash
bun run build
bun run test
bun run format:ci
bun run lint:ci
bun run duplicates:ci
bun run knip:ci
bun run audit
```

`bun run test` runs the test suite with [Vitest](https://vitest.dev/). The `pretest` script builds first.

`bun run audit` runs the dependency audit that also backs [.github/workflows/security.yml](.github/workflows/security.yml).

Keep changes focused, squash the branch to a single commit before opening the pull request, add or update tests when behavior changes, and describe the motivation in the pull request so reviewers can follow your intent.

### Improving The Documentation

Documentation lives in the repository root (`README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `AGENTS.md`) and in `help.md` (CLI help text). Typos, clarifications, and examples that match current behavior are welcome as pull requests.

`AGENTS.md` is the agent-oriented index and command reference; it must stay aligned with the human docs and with reality (`package.json`, `.github/workflows`, `vitest.config.js`, and so on). When your change updates how the repo is developed, tested, released, or explained to contributors, update **every** affected doc in the same pull request so nothing drifts.

If you are restructuring large sections or changing how features are presented, open an issue first so maintainers can agree on direction before you invest significant time.

Markdown and JSON touched by your change are formatted with Oxfmt on commit via lint-staged, and the repo also runs dedicated lint and format CI workflows on pull requests; run `bun run lint:ci` and `bun run format:ci` locally if you want to catch issues early.

## Styleguides

### Commit Messages

Commit messages **must** follow [Conventional Commits](https://www.conventionalcommits.org/).

Use `type(scope): subject` on the first line: imperative, lowercase subject after the colon, no trailing period, and roughly 50 characters or less for the whole first line when practical. Common types here include `fix`, `feat`, `docs`, `chore`, `test`, `refactor`, `perf`, and `ci`. Omit `scope` when nothing clearer than the whole repo applies.

Add a body after a blank line when the motivation or trade-offs are not obvious from the diff. Use a `BREAKING CHANGE:` footer (or `!` after the type/scope per the spec) when you introduce incompatible API or behavior changes.

Reference related issue or pull request numbers in the subject or body when it helps future readers.

## Join The Project Team

There is no formal application process. Consistent, respectful participation through issues and pull requests is how people become trusted voices in the project over time.

If you plan sustained work on a larger change, open an issue early to coordinate with maintainers and avoid duplicate effort. Everyone is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

<!-- omit in toc -->

## Attribution

This guide is based on the [contributing.md](https://contributing.md/generator)!
