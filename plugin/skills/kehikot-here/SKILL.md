---
name: kehikot-here
description: Assign this OpenCode conversation to the kehikko on screen in Kehikot. Only a person runs it, by typing /kehikot-here (add "own" to make it that kehikko's own conversation, or "kehikko: <key>" to name one).
---

The person typed `/kehikot-here` to assign THIS conversation to the kehikko they have on screen in Kehikot. SAY is the words they wrote after `/kehikot-here` — `own`, `kehikko: <key>`, both, or nothing: $ARGUMENTS

1. Call the `kehikot_here` tool once, with `say` set to SAY exactly (an empty string when they wrote nothing). Kehikot gave this conversation that tool; it knows which conversation this is by itself.
2. If its answer begins with "Kehikot:", tell the person that answer, word for word, and stop. Do nothing else: the module has done what was asked, or said why not and what to type instead.
3. If there is no `kehikot_here` tool, tell the person this one line and stop: "Kehikot: /kehikot-here works in an OpenCode conversation Kehikot started (open it from an OpenCode container on a kehikko). [skill {{version}}]"

Never call the tool again on your own, or with other words: only the person assigns a conversation, by typing `/kehikot-here`.

Once this conversation has a place: when you or a subagent finish researching something (investigating, comparing, auditing, reading up), say so with `tell_finished({ event: "research-complete", label })` on the OpenCode module's MCP server (kehikko-opencode), and the person gets a "Research complete" notice. (Module: {{origin}})
