#!/usr/bin/env bash
# The narrative printed in the VHS recording (docs/social/bearing.tape runs this).
#
# VHS `Type` types literal characters — no color. To get the same coloured punch as the HTML
# mockup (terminal.html), the scene is printed here with 24-bit ANSI codes matching the bearing
# palette exactly:
#   bad=#d95926  good=#199e70  accent=#3987e5  dim=#9aa8bd  faint=#61708a  ink=#e8edf5
# Timing lives here (sleeps), so the tape just runs the script and waits for it to finish.

bad=$'\x1b[38;2;217;89;38m'
good=$'\x1b[38;2;25;158;112m'
accent=$'\x1b[38;2;57;135;229m'
dim=$'\x1b[38;2;154;168;189m'
faint=$'\x1b[38;2;97;112;138m'
ink=$'\x1b[38;2;232;237;245m'
rst=$'\x1b[0m'

clear
printf '\n  %sagent session — risk-module%s\n\n' "$faint" "$rst"
sleep 0.5

# Scene 1 — the agent drifts, ships a killed feature, nothing fails.
printf '  %sagent>%s %sI'"'"'ll add averaging-in to the risk module —%s\n' "$faint" "$rst" "$ink" "$rst"
sleep 0.7
printf '         %sit improves fill rates.%s\n' "$ink" "$rst"
sleep 0.8
printf '  %s✓ wrote src/risk/avg.ts%s\n' "$good" "$rst"
sleep 0.4
printf '  %s✓ tests pass · committed%s\n' "$good" "$rst"
sleep 0.8
printf '  %s(nothing fails. the premise was measured & killed in Q1)%s\n' "$dim" "$rst"
sleep 0.6
printf '  %s⏱ found out 3 days later%s\n' "$bad" "$rst"
sleep 1.2

printf '\n'
sleep 0.4

# Scene 2 — the same intent, caught against the north-star.
printf '  %sagent>%s %sI'"'"'ll add averaging-in to the risk module—%s\n' "$faint" "$rst" "$ink" "$rst"
sleep 0.6
printf '  %sbearing ⚠%s %sNS-9 — REJECTED: averaging into a losing%s\n' "$accent" "$rst" "$ink" "$rst"
sleep 0.5
printf '         %sposition. Measured: adds fill only on weaker%s\n' "$ink" "$rst"
sleep 0.5
printf '         %scases. Cite a north-star or re-open with new evidence.%s\n' "$ink" "$rst"
sleep 1.0
printf '  %sagent>%s %sCiting NS-9. I will not re-propose without new evidence.%s\n' "$faint" "$rst" "$good" "$rst"
sleep 0.8
printf '  %s✓ caught in one line%s\n' "$good" "$rst"
sleep 1.5