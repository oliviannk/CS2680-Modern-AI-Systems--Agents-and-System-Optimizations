https://cs2680.com/assignments/assignment1

Assignment 1 — Experience a coding agent (10%)
作业 1 — 体验编码代理 （10%）
Out Wed Sep 2 · due Sun Sep 20, 11:59pm · individual · all five assignments

Build a web page that drives Claude Code: you type a request, the agent works on a directory of your choice, and the page shows you what it is doing while it does it.
构建一个驱动 Claude 代码的网页：你输入请求，代理在你选择的目录上工作，页面在执行时显示它正在做什么。

The assignment is deliberately small, and it is the one assignment nothing later in the course is measured against. Serving it on your own machine is enough. This is a creative task. Part 2 fixes what the page must do; how it looks and how it works are yours to design, and the interesting decisions (what a run in progress should look like, how much of a tool result to show, how a failure should read) are exactly the ones the spec leaves open.
作业刻意设计得很小，而且是课程后面唯一一个不做对比的作业。在自己的机器上提供就足够了。这是一项创造性任务。第二部分确定了页面必须做的事情;它的外观和工作方式由你设计，而有趣的决策（比如运行中应该是什么样子、显示多少工具结果、失败如何读取）正是规格书中留下的开放。

All five assignments submit code through one private GitHub repository shared with the teaching fellows; this assignment lives in its assignment1/ directory. See Deliverables.
所有五个作业都通过一个私有的 GitHub 仓库提交代码，该仓库与教学研究员共享;该分配存在于 assignment1/ 目录中。参见 交付物 。

Build the frontend with Claude Code too. It is the fastest way to get a working page, and watching the agent build it teaches you what the page should show.
前端也用 Claude 代码构建。 这是最快获得一个可用页面的方法，而且 看着代理搭建页面，你会教会页面应该显示什么。
Learning goals  学习目标
Use Claude Code to build working software.
用 Claude 代码来构建可用的软件。
Drive an agent programmatically (headless mode and its event stream) rather than only interactively.
通过程序化（无头模式及其事件流）驱动代理，而不仅仅是交互式。
Watch a trajectory as it happens: what the agent reads, what it runs, and what that costs.
观察一个轨迹：代理人读取了什么，运行了什么，以及这带来了多少成本。

Part 1 — Drive Claude Code from a terminal
第一部分 — 从终端驱动 Claude 代码
Headless mode. Claude Code runs non-interactively when invoked with -p, and with --output-format stream-json it prints one JSON event per line as the run proceeds (in print mode, this output format also requires --verbose). The stream is an init event, then assistant messages and tool calls and their results, then a final result event carrying total_cost_usd, duration_ms, num_turns, and the session_id. A minimal run, with the events trimmed to their load-bearing fields:
无头模式。Claude 代码在调用 -p 时非交互式运行，而在 --output-format stream-json 中，运行过程中每行打印一个 JSON 事件（在打印模式下，该输出格式也需要 --verbose）。该流是一个初始事件，那么 助手消息和工具调用及其结果，然后是最终结果事件 total_cost_usd、duration_ms、num_turns，以及 session_id。这是一次极简的跑步，项目被剪辑到承重场地：

$ claude -p "Say hello in one short sentence." --output-format stream-json --verbose
{"type":"system","subtype":"init","session_id":"fe891e8a-…","cwd":"…","model":"…","tools":[…],…}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello! How can I help you today?"}],…},…}
{"type":"result","subtype":"success","num_turns":1,"duration_ms":4333,"total_cost_usd":0.137852,"session_id":"fe891e8a-…",…}
A prompt that makes the agent work (e.g. “read main.py and add a --help flag”) interleaves more assistant events whose content is tool_use blocks, and user events carrying the matching tool_result; those are what your page will render. Passing the result event's session id back (claude -p --resume <session-id> "<follow-up>" …) continues the conversation. See the headless mode documentation.
使代理工作提示（例如“阅读 main.py 并添加 --help 标志”）会交错显示内容为 tool_use 块的助手事件和携带匹配 tool_result 的用户事件;这些就是你的页面会渲染的内容。将结果事件的会话 ID（claude -p ---resume <session-id> “<follow-up>” ...）传递 对话。参见 无头模式文档 。

Before writing any web code, run this in a terminal against a scratch directory and read the events it prints, because the frontend you build in Part 2 is a renderer for exactly this stream. Then save one complete run to a file (claude -p "<prompt>" --output-format stream-json --verbose > events.jsonl); it becomes your test input in Part 2.
在写任何网页代码之前，先在终端里对着一个临时目录运行，读取它打印的事件，因为你在第二部分构建的前端就是为这条流做的渲染器。然后将一次完整运行保存到文件（claude -p “<prompt>” --output-format stream-json --verbose > events.jsonl）;它会成为第二部分的测试输入。

Turn on auto-accept so runs are not stopped by permission prompts. By default, Claude Code asks before editing a file or running a command. In an interactive session, press Shift+Tab to switch into auto-accept mode. In a headless run there is nobody to ask, so requests that need approval are refused instead: start the run with --dangerously-skip-permissions to auto-approve everything (the right choice against a scratch directory), or with --allowedTools (e.g. --allowedTools "Edit" "Bash(pytest:*)") to auto-approve only the named tools, and pass the same flag when your Part 2 server spawns the agent.
开启自动接受，这样运行不会被权限提示阻止。 默认情况下，Claude Code 在编辑文件或执行命令前会先询问。在交互式会话中，按 Shift+Tab 切换到自动接受模式。在无头运行中，没有人可请求，因此需要批准的请求会被拒绝：以 --dangerously-skip-permissions 启动运行，以自动批准所有内容（这是对 scratch 目录的正确选择），或者使用 --allowedTools（例如， --allowedTools “编辑” “Bash（pytest：*）”）只自动批准指定的工具，并传递 当你的 Part 2 服务器生成代理时，同样的标志。
Authenticate with your Harvard login, and do not use the Agent SDK or an API key. Headless mode reads the same stored credential as interactive Claude Code, so the Harvard login you already have is the whole setup. The Agent SDK is the wrong tool here for two reasons. First, Anthropic's usage policy directs SDK use to API keys from Claude Console, which the course does not provide. Second, an exported ANTHROPIC_API_KEY takes precedence over your Harvard login, so setting one silently bills your own account.
请用你的哈佛登录进行身份验证，不要使用代理 SDK 或 API 密钥。 无头 模式读取的存储凭证与交互式 Claude 代码相同，因此 你已经拥有的哈佛登录就是全部设置。代理 SDK 这里是错误的工具，原因有两个。首先，人类的 使用政策 将 SDK 使用到 Claude Console 的 API 密钥，而课程中没有提供该密钥。第二，导出 ANTHROPIC_API_KEY 优先于你的哈佛登录，所以设置一个账户会悄无声息地向你的账户计费 自己的账号。
Part 2 — The frontend
第二部分 — 前端
Now put a web page in front of what you just ran: your server spawns the Part 1 command as a subprocess, forwards its events to the browser, and keeps the session id so a follow-up prompt can resume. The page needs seven features. Each is stated as what the page must do; how it does it is yours to decide. The sketch under each feature shows the behavior it requires, not a design you must copy.
现在在你刚运行的程序前面放一个网页：你的服务器会把 Part 1 命令作为子进程生成，把事件转发到浏览器，并保留会话 ID，以便后续提示继续。页面需要七个功能。每个页面都明确说明了该页面必须做的事;怎么做由你自己决定。每个特征下的草图显示的是它所需的行为，而不是必须复制的设计。

Submit a prompt. A text box sends your request to Claude Code, which runs against a working directory you choose, and the page can start another run when the first finishes.
提交提示。 文本框会将你的请求发送到 Claude 代码，Claude 代码运行在 你选择工作目录，当第一次运行结束后，页面可以开始下一次运行。
working directory
~/scratch/demo-repo
find the bug that makes test_parse fail and fix it
Run
Show the trajectory live. The trajectory is what the agent did, event by event: the assistant's text, and every tool call with its name and input (reading parser.py, running pytest, editing a file). Render each event when it arrives, not after the run ends. The assistant's text is usually markdown, so render it as formatting rather than showing the raw markup.
现场直播轨迹。 轨迹是代理人逐事件所做的： 助手的文本，以及每个工具调用及其名称和输入（阅读 parser.py，运行 pytest，正在编辑文件）。每个事件到达时渲染，而不是运行结束后。该 助理的文本通常是 Markdown 格式，所以应以格式化方式渲染，而不是显示原始标记。
running
The test expects a trailing newline. I will read the parser first.
Read
tests/test_parse.py
✓
Bash
pytest -x
✓
Edit
src/parser.py
pending
Show tool results. Each tool call's result appears with it, and long ones are cut down deliberately (a test log can run thousands of lines, and a page it buries is a page nobody reads). How much to show and how to fold the rest is a design decision you should make.
展示工具结果。 每个工具调用的结果都随之出现，长调用则被切割 这是故意为之（测试日志可以有成千上万行，而它掩盖的页面则是没人会看的页面）。多少钱 展示和如何折叠剩下的部分是你应该做的设计决策。
Bash
pytest -x
✓
FAILED tests/test_parse.py::test_parse
ValueError: unexpected token ')'
▸ 87 more lines, folded
Show status, per tool call and per run. Status lives at two levels, and the page shows both, the way the Claude Code terminal does. (1) Per tool call: a call is pending from the moment its tool_use block arrives until the matching tool_result attaches (the two share the call's id), and a result that reports an error is visibly one. (2) Per run: the agent works autonomously until the final result event ends the round, so show whether the run is in progress, finished, or failed, and a failing run (a bad directory, an agent error) produces a visible error rather than a page that waits forever.
显示状态，按每次工具调用和每次运行。 状态有两个层级，页面显示 两者都有，就像 Claude Code 终端那样。（1） 每个工具调用：调用从其执行的那一刻起即处于待处理状态 tool_use 块会到达，直到匹配的 tool_result 连接（两者共享） 呼叫的 ID），而报告错误的结果是明显的错误。（2） 每次运行：代理人工作 直到最终结果事件结束该轮，因此显示该连串是否正在进行中， 完成了，或失败，失败的运行（坏目录、代理错误）则会显示明显错误 而不是那一页永远等待的页面。
during the run · per tool call
Bash
pytest -x
✓
Edit
src/parser.py
pending
the round ends · per run
All 12 tests pass.
✓ finished
a failing run
You
start a run in /bad/path
✕ failed
Error: /bad/path is not a directory (exit 1)
Continue the conversation. A follow-up prompt resumes the same session, so the agent keeps its context from the previous turn.
继续对话。 跟进提示会继续同一会话，所以代理 保持了上一回合的上下文。
You
add a --json flag to the CLI
▸ 23 events, folded
Added the --json flag and updated the tests.
✓ finished
$0.58 · 42 s · 12 turns · session_id fe891e8a-…
You
now update the README for it
running
resumed session fe891e8a-…
Show the run's numbers. When a run finishes, display its cost in dollars, its wall-clock duration, and its number of turns. Claude Code reports all three in its final result event, so this is a display feature, not a measurement exercise.
展示跑量。 当一次跑步结束时，用美元和挂钟显示其成本 持续时间及其回合数。Claude Code 在其最终结果事件中报告了这三者，因此这是一个 显示功能，而非测量练习。
Added the --json flag and updated the tests.
✓ finished
$0.58 · 42 s · 12 turns · session_id fe891e8a-…
Show the trajectory as a tree. The event sequence you rendered in feature 2 is not always flat: Claude Code can delegate work to subagents, and every event a subagent emits carries a parent_tool_use_id naming the tool call that spawned it (events from the main agent carry null there). Nest each subagent's events under that tool call, collapsible so a long subagent run does not bury the main agent's events, and keep a run with no subagents rendering as the flat list of feature 2. In addition, show an outline of the whole trajectory beside the dialogue, just the call names, like a table of contents, so the reader can survey the run and jump to a call. Whenever the window is wide enough, the outline is displayed alongside the dialogue rather than as a strip fixed to the top of the page; on a narrow window it may fold away. Beyond these two views, you are welcome to design a better visualization of the trajectory. Subagents appear only when a run uses one, so demonstrate this with a prompt that asks for one (“use a subagent to survey this directory”).
把轨迹展示成一棵树。 你在功能 2 中渲染的事件序列不是 始终平坦：Claude Code 可以将工作委派给子代理，每个子代理发出的事件都包含 parent_tool_use_id 为生成该任务的工具调用命名（主代理的事件 这里是 null）。将每个子代理的事件嵌套在该工具调用下，可折叠，因此子代理较长 运行不会埋藏主代理的事件，而是将无子代理渲染的运行作为 的平面列表 特点二。此外，请在对话旁边展示整个航线的轮廓，只标注呼号， 就像目录一样，读者可以浏览整个跑步并跳转到呼叫。无论窗户何时 轮廓足够宽，是与对话并列显示的，而不是作为一条固定在顶部的条带 页面;在狭窄的窗户上，它可能会折叠收起。超越 这两种视图，你可以设计出更清晰的轨迹可视化。 子代理仅在运行使用该代理时出现， 所以用一个提示来展示这一点，提示你是否会做一个（“用一个分代理来勘察这个 目录“）。
Bash
pytest -x
✓
Tasks
Task
survey this directory
Read
src/parser.py
✓
Grep
"TODO"
✓
A small parser package with one failing test.
Task
summarize the README
· 4 events collapsed
Edit
src/parser.py
✓
outline
Bash
Task
Task
Read
Grep
Edit
Put together, the seven features are one page. The sketch below shows one possible whole: a first run that finished with its numbers, a second run resumed from the same session and still in progress, one tool result expanded and folded, and a subagent nested under its Task call. It shows the behavior, not a design you must copy.
七部长片合起来合为一页。 下面的草图展示了一个可能的整体：第一次运行以数字结束，第二次运行从同一会话恢复且仍在进行中，一个工具结果展开折叠，以及一个嵌套在其任务调用下的子代理。它展示的是行为，而不是必须复制的设计。

outline
Read
Read
Grep
Edit
Bash
Read
Edit
Bash
Edit
Bash
Bash
You
Read
Task
Task
Read
Glob
Grep
Read
Edit
working directory
~/scratch/demo-repo
You
add a --json flag to the CLI
▸ 23 events, folded
Added the --json flag and updated the tests.
✓ finished
$0.58 · 42 s · 12 turns · session_id fe891e8a-…
You
use subagents to survey the repo, then update the README
running
resumed session fe891e8a-…
I will run two surveys, then edit the README.
Read
README.md
✓
# demo-cli
A small CLI for parsing logs.
▸ 34 more lines, folded
Tasks
Task
survey the code
Read
src/cli.py
✓
Grep
"--json"
✓
cli.py implements --json.
Task
survey the docs
· 5 events collapsed
Edit
README.md
pending
type a follow-up…
Run
Try to improve beyond the required features. An agent usually does the minimal job that meets the expectation of your prompt, so the first working version of your frontend will probably not be friendly to use. The seven features are just the basic requirement, but you can be more creative: make the page more intuitive, make what you are looking for easier to find, and make a run in progress easier to follow. Use the page yourself, notice where it annoys you, and fix that. Much of the enjoyment of this assignment is watching your frontend grow friendlier to a human with each change, and the writeup's first section asks for the improvements you made.
尽量超越所需的功能。 代理通常只做符合你提示期望的最低限度工作，所以你前端的第一个可用版本可能不太友好。这七个功能只是基本要求，但你可以更有创意：让页面更直观，让你想要的内容更容易找到，让进行中的游戏更容易跟上。自己用页面，注意哪里让你不舒服，然后修正。这项作业的乐趣很大一部分是看到你的前端随着每一次变化变得更友好，文章的第一部分就是询问你所做的改进。

Give the agent something to work on. Your page drives Claude Code against a working directory, and a demo on an empty one shows nothing worth watching, so keep a small real codebase around for the agent (separate from the frontend's own repository is simplest). Any project with a few files and a test suite works: an old class project, a small open-source tool you use, or a copy of the frontend you are building itself. Tasks that demo well are concrete and multi-step (“find the bug that makes test_parse fail and fix it”, “add a --json flag and update the README”), because they make the agent read, run, and edit, which is exactly what features 2 and 3 display.
给经纪人一些可以改进的地方。 你的页面驱动克劳德代码对工作进行检测 目录，而一个空的演示版显示没有什么值得关注的内容，所以保留一个小型真实代码库 代理（与前端仓库分开）是最简单的。任何有几个文件和测试的项目 套件工作：一个旧的课堂项目，一个你用的小型开源工具，或者你用的前端副本 建筑本身。演示良好的任务是具体且多步骤的（“找到能让它成为的漏洞” test_parse 失败并修复它“，”添加一个 --json 标志并更新 README“），因为它们让代理读取、运行和编辑，而功能 2 和 3 显示的内容正是如此。

Test efficiently by replaying a recorded stream. Develop the rendering against a saved events.jsonl, by giving your server a replay mode that reads the file instead of spawning the agent. A live run takes a minute or more and spends real usage, while replaying a recorded stream is instant and free, so it is the difference between a ten-second edit-test loop and a one-minute one. Test against live runs at the end, because two things only they can exercise: the events must render as they arrive rather than after the run ends, and session resume needs a real session id. For the tree view, save a second events.jsonl from a run that spawns a subagent, so that rendering too can be developed in replay.
通过重播录制的直播高效测试。 用保存的版本开发渲染 通过给服务器一个重放模式，读取文件而不是生成代理，是 events.jsonl。直播运行需要一分钟或更长时间，且使用实际使用时间，而录制的直播播放则是即时且免费的，因此这就像十秒编辑测试循环和一分钟循环之间的区别。测试最后的实时运行，因为只有他们能实现两件事：事件必须按实际运行方式呈现，而非事后进行 运行结束后，会话恢复需要一个真实的会话 ID。关于树状视图，请多花一秒钟 events.jsonl，从生成子代理的运行中提取，这样渲染也能在重放中开发。

Any language and any web stack are fine. However, do not use an agent framework or reimplement the agent loop (that is Assignment 2).
任何语言和任何网页栈都可以。但不要使用代理框架，也不要重新实现代理循环（即任务2）。

Where to run it. Your own machine is enough, and grading does not require a public URL. If you want the page reachable from other devices, a CloudLab or AWS machine works too; in that case put a random access token in front of it (e.g. openssl rand -hex 16, kept out of the repository) and reject every request without it, because a public page here is a remote control for a process that reads files and runs commands on that machine. Either way, point the agent at a scratch directory rather than at your home directory: your page, your screenshot, and your demo show everything it reads. If you have trouble getting set up on your own laptop, feel free to reach out to the teaching fellows for help.
在哪里运行。 只要你自己的电脑就足够了，评分不需要公共网址。如果你想让页面能被其他设备访问，比如 CloudLab 或者 AWS 机器也能用;在这种情况下，在它前面放置一个随机访问令牌（例如， OpenSSL RAND -hex 16，未进入仓库）并拒绝所有未包含该请求的请求，因为这里的公共页面是远程控制读取文件和执行命令的进程。无论哪种方式，都应该让代理指向一个临时目录，而不是你的主目录：你的页面、截图和演示文件都会显示它读取的所有内容。如果你在自己的笔记本上设置困难，可以随时联系助教人员寻求帮助。

Part 3 — Writeup
第三部分 — 写作
Markdown or PDF, committed to the repository as assignment1/writeup.md or assignment1/writeup.pdf. There is no page limit, and do not pad: a brief writeup that makes every point clearly is enough. Write the prose yourself. The writeup reports what you observed and learned, so a writeup generated entirely by AI defeats that purpose and will incur a penalty. The writeup includes three sections:
Markdown 或 PDF，提交到仓库时以 assignment1/writeup.md 形式提交，或者 作业 1/writeup.pdf。没有页数限制，也不要冗长：简短的介绍，清晰地表达每个观点就足够了。 你自己写散文。 报道报告 你观察和学到的内容，所以完全由 AI 生成的文章违背了这个目的，还会带来 罚球。本文分为三个部分：

What you built. One paragraph and one screenshot of what the frontend does, plus the improvements you made beyond the seven required features, as a bullet list or folded into the paragraph if the list is too long.
你建造的东西。 前端功能和一截图，以及你在七个必备功能之外所做的改进，作为项目符号列表，或者如果列表太长，可以合并到段落中。
What you learned. Three observations are required, each tied to a specific moment in a session. (1) How the agent works: where it spent more time than you expected, what it read that you would not have read, or how it approached the task differently than you would have. (2) A pitfall: what went wrong or surprised you, how you noticed, and what you would warn a classmate about. (3) A lesson: what you would do differently the next time you use an agent, how you would prompt, scope, or supervise it better, and what in the session taught you that. Beyond these three, you are welcome to add more: insights, or new tools, skills, and plugins you picked up along the way.
你学到了什么。 需要三项观察，每项都与会话中的具体时刻相关联。（1）代理的工作方式：它花了比你预期更多的时间，它读取了你不会看到的内容，或者它如何以不同于你的方式完成任务。（2）陷阱：哪里出了问题或让你感到惊讶，你是如何察觉的，以及你会提醒同学什么。（3）一个教训：下次使用代理时，你会做些什么不同的事，如何更好地提示、定位或监督，以及在那次会议中教会了你这些。除了这三者，你还可以补充更多：见解，或者你一路上学到的新工具、技能和插件。
One thing you would change. If you could change one thing about how Claude Code works (not about your frontend), what would it be, and what did you see that makes you want it?
有一件事你会改变。 如果你能改变 Claude 代码的工作方式（不是前端），你会改变什么？你看到了什么让你想要它？
If you want more
如果你想看更多
None of the following is required or graded, but each is a real feature of the tool you have just built, and the students who enjoy this assignment tend to keep using their frontend all semester: a stop button that cancels a running agent, approve or deny buttons for permission prompts, a diff view of the files the agent changed, and several sessions running in parallel tabs.
以下内容都不是必做或评分的，但每一项都是你刚构建的工具的真实功能，喜欢这项作业的学生通常整个学期都会用他们的前端：一个取消正在运行的代理的停止按钮，许可提示的批准或拒绝按钮，代理更改的文件的不同视图， 以及多个并行标签页运行的会话。

Deliverables  交付成果
One repository serves the whole course: all five assignments submit their code, writeup, and session files through a single private GitHub repository, shared with the instructor and the teaching fellows and nobody else. Only the demo video is uploaded to Canvas. Create it once, put this assignment in an assignment1/ directory, and later assignments go in assignment2/, assignment3/, and so on. Invite the instructor and the four TFs, GitHub usernames 1a1a11a, LauYeeYu, SeverinaZheng, G6KlayWang, and AdvaithRavishankar.
一个仓库负责整个课程：五个作业都通过一个私有的 GitHub 仓库提交代码、写作和会话文件，该仓库与讲师和教学助理共享，不与其他人共享。只有演示视频上传到 Canvas。创建一次，把这个任务放到 assignment1/ 目录里，之后的任务就放到 assignment2/、assignment3/ 等文件夹里。邀请讲师和四位 TF，GitHub 用户名 1a1a11a、LauYeeYu、SeverinaZheng、G6KlayWang 和 AdvaithRavishankar。

Your code, in assignment1/ of the shared repository, with a README saying how to start the server.
你的代码 ，在共享仓库的 assignment1/ 中，附带一个 README，说明如何启动服务器。
The writeup, at assignment1/writeup.md or assignment1/writeup.pdf in the repository.
写作 ，请在 assignment1/writeup.md 或 在仓库中分配 1/writeup.pdf。
A demo video (2–3 minutes), uploaded to Canvas, of the frontend handling a real multi-turn task, with the agent's tool calls visibly streaming while it works. The video must show every one of the seven features, including a failing run and a run that spawns a subagent. In addition, you may sign up to present your frontend live at the sharing session on Sep 21 (the sign-up link will be released on Canvas). The live presentation is optional and can earn up to four bonus percentage points under the presentation feedback criteria.
一段 2-3 分钟的演示视频 ，上传到 Canvas，展示了前端操作真实的 多回合任务，代理的工具调用在工作时会明显流畅播放。视频必须展示所有 七个功能之一，包括失败运行和生成子代理的运行。此外，你也可以 注册以在9月21日的分享环节上实时展示你的前端（报名链接将会发布 画布上）。现场演示为可选，最多可获得4个百分比的奖励。 演示反馈标准 。
Your Claude Code session files, archived as described in What to submit with each assignment and committed to assignment1/ of the repository. Check that your .gitignore does not exclude the archive. As on every assignment, they carry no separate points; they are the record behind the write-up's claims.
您的 Claude Code 会话文件 ，已按描述归档 每个作业都应该提交什么 ，并且承诺了什么 仓库的赋值 1/。检查你的 .gitignore 文件是否排除了该归档。和所有作业一样，它们没有单独的积分;这些记录是报道背后的说法。
Grading  分级
Weight  重量	Component  组成部分
70%	The seven required features, 10% each, graded working / partially working / absent from your demo video, with the repository as supporting evidence
这七个必备功能，各占10%，在演示视频中评级为工作/部分工作/缺失，并以仓库作为支持证据
20%	Writeup: section 2 carries most of it, and specific, session-anchored observations earn what generic praise does not
总结：第二部分涵盖了大部分内容，具体的、以会话为核心的观察能获得泛泛的赞扬所不能获得的回报
10%	Visual design: layout and readability
视觉设计：布局与可读性
Features  特色
Judged from your demo video: 10% for the behavior below, partial credit for a partial implementation, zero if never demonstrated.
从你的演示视频来看：以下行为得10%，部分实现得部分功劳，若未展示则为零。

Feature  特色	Full credit  完整署名
Submit a prompt  提交提示	Submitting from the page starts a run against a working directory you choose, and a second run can be started from the same page after the first finishes.
从页面提交会开始对你选择的工作目录进行一次运行，第一次提交结束后可以从同一页面开始第二次运行。
Show the trajectory live  现场直播轨迹	Assistant text and every tool call (name and input) appear in order while the run is in progress, and markdown in the assistant's text renders as formatting, not raw markup.
助手文本和每个工具调用（名称和输入）在运行过程中按顺序显示，助理文本中的标记显示为格式化，而非原始标记。
Show tool results  显示工具结果	Every tool call's result is visible with it, and long outputs are deliberately cut down or folded so the page stays readable.
每次工具调用的结果都可见于此，长输出会被故意裁剪或折叠，以确保页面可读性。
Show status, per tool call and per run
显示状态，按工具调用和每次运行	A tool call is visibly pending until its result arrives and visibly an error when the result reports one; the run's in progress, finished, and failed states are distinguishable; and the demonstration shows one failing run (e.g. a bad working directory) producing a visible error.
工具调用在结果到达前是明显待处理的;当结果报告错误时，则明显为错误;进行中、已完成和失败状态是可区分的;演示显示一次失败运行（例如工作目录不良）会产生可见错误。
Continue the conversation
继续对话	A follow-up prompt resumes the same session, and the demonstration shows the carried context (e.g. a follow-up that only makes sense given the previous turn, answered correctly).
后续提示会继续同一会话，演示显示所携带的上下文（例如，只有在前一回合正确回答后才有意义的后续提示）。
Show the run's numbers  显示跑数	Cost in dollars, wall-clock duration, and turn count from the result event are displayed for each finished run.
每次完成跑程都会显示出以美元计费、墙时钟持续时间和回合数。
Show the trajectory as a tree
将轨迹展示为一棵树	A run that spawns a subagent shows which events belong to which subagent (nested under the spawning call, or an equivalent visualization of your own design), an outline of just the call names sits beside the dialogue on a wide window, long subagent runs can be folded away, and a run with no subagents still renders correctly.
生成子代理的运行会显示哪些事件属于哪个子代理（嵌套在生成调用下，或你设计的等效可视化），对话框旁边的大窗口上会显示调用名称的轮廓，长时间的子代理运行可以折叠，没有子代理的运行依然能正确渲染。
