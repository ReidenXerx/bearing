#!/usr/bin/env bash
# bearing statusline for Claude Code — a two-line cockpit.
#
# Line 1: identity    — model / effort / thinking / branch / repo
# Line 2: consumption — context, 5h + 7d burn (with pace warning), prompt-cache TTL,
#                       machine vitals, index freshness
#
# The rule everything here is written to: a field either costs quota or blocks tools,
# and anything that is merely *fine* stays silent. A status line you have to read
# carefully is one you stop reading, so it only speaks up when something is off.
#
# The index field is the bearing-specific one, and the reason this ships with the kit:
# a stale index DENIES Grep/Read/MCP in this repo, so its state belongs on screen
# instead of being discovered by a blocked tool call halfway through a task.
#
# Claude Code pipes a JSON status payload on stdin and renders stdout, ANSI and all.
# Without jq the line degrades to the word "claude" rather than failing.
#
# PORTABILITY: Linux and macOS (incl. Apple Silicon), bash 3.2+ — macOS still ships
# bash 3.2, so no EPOCHSECONDS/declare -A/mapfile here. Platform-specific probes
# degrade to silence rather than to errors, so an unsupported box simply shows less.
#
# Tunables (env):
#   SL_NERD=0        branch glyph needs a Nerd Font; 0 drops it
#   SL_VITALS=0      disable the machine-vitals lane entirely
#   SL_MEM_WARN_MB   warn under this much available RAM (default 2048)
#   SL_IO_WARN       warn over this IO-stall percentage, Linux only (default 15)

export LC_ALL=C
payload=$(cat)
command -v jq >/dev/null 2>&1 || { printf 'claude'; exit 0; }

# One timestamp per render: $EPOCHSECONDS where it exists (bash 5, no fork), one
# date(1) call on bash 3.2. A single value also keeps every countdown consistent.
NOW=${EPOCHSECONDS:-$(date +%s)}

R=$'\e[0m'; D=$'\e[38;5;244m'; GY=$'\e[38;5;250m'
GRN=$'\e[38;5;114m'; YLW=$'\e[38;5;179m'; RED=$'\e[38;5;203m'
BLU=$'\e[38;5;110m'; MAG=$'\e[38;5;176m'; CYN=$'\e[38;5;109m'
# U+E0A0 (Nerd Font branch) as raw UTF-8 bytes: $'\uXXXX' does not expand under LC_ALL=C.
# Private-use codepoint, so it needs a patched font — SL_NERD=0 drops it and the branch
# name stands alone. Every other glyph below is standard Unicode and renders anywhere.
# The trailing space lives in the variable so the empty case doesn't leave a double gap.
if [ "${SL_NERD:-1}" = 1 ]; then BR=$'\356\202\240 '; else BR=''; fi

IFS=$'\x1f' read -r model effort thinking fastmode style curdir projdir reponame \
    ctxpct ctxsize exceeds durms ladd lrem \
    h5 h5reset d7 d7reset cachewarm cacheexp recache <<<"$(
  printf '%s' "$payload" | jq -r '
    [ (.model.display_name             // "?")
    , (.effort.level                   // "")
    , (if .thinking.enabled then "1" else "" end)
    , (if .fast_mode        then "1" else "" end)
    , (.output_style.name              // "default")
    , (.workspace.current_dir          // .cwd // "")
    , (.workspace.project_dir          // "")
    , (.workspace.repo.name            // "")
    , (.context_window.used_percentage // -1 | floor)
    , (.context_window.context_window_size // 0)
    , (if .exceeds_200k_tokens then "1" else "" end)
    , (.cost.total_duration_ms         // 0 | floor)
    , (.cost.total_lines_added         // 0)
    , (.cost.total_lines_removed       // 0)
    , (.rate_limits.five_hour.used_percentage // -1 | floor)
    , (.rate_limits.five_hour.resets_at       // 0 | floor)
    , (.rate_limits.seven_day.used_percentage // -1 | floor)
    , (.rate_limits.seven_day.resets_at       // 0 | floor)
    , (if (.prompt_cache != null) and (.prompt_cache.warm == false) then "" else "1" end)
    , (.prompt_cache.expires_at              // 0 | floor)
    , (.prompt_cache.recache_tokens_if_cold  // 0 | floor)
    ] | map(tostring) | join("\u001f")' 2>/dev/null
)"
[ -n "$model" ] || { printf 'claude'; exit 0; }

# Any value used in (( )) must be a plain integer; a float or empty string is a
# hard syntax error that would blank the whole status line.
int() { case $1 in ''|*[!0-9-]*) printf '0' ;; *) printf '%s' "$1" ;; esac; }
for v in ctxpct ctxsize durms ladd lrem h5 h5reset d7 d7reset cacheexp recache; do
    printf -v "$v" '%s' "$(int "${!v}")"
done

# ── helpers ───────────────────────────────────────────────────────────────────
# 8-cell burn bar. Rounds to nearest so a near-zero percentage reads as empty
# rather than borrowing a block it hasn't earned.
bar() {
    local pct=$1 w=8 f i out=''
    f=$(( (pct * w + 50) / 100 )); (( f > w )) && f=$w; (( f < 0 )) && f=0
    for ((i = 0; i < w; i++)); do (( i < f )) && out+='▰' || out+='▱'; done
    printf '%s' "$out"
}
heat() { local p=$1; (( p >= 85 )) && printf '%s' "$RED" && return; (( p >= 60 )) && printf '%s' "$YLW" && return; printf '%s' "$GRN"; }
dur()  { # ms → 48s / 5m / 1h12m
    local s=$(( $1 / 1000 ))
    (( s < 60 ))   && { printf '%ds' "$s"; return; }
    (( s < 3600 )) && { printf '%dm' $(( s / 60 )); return; }
    printf '%dh%dm' $(( s / 3600 )) $(( (s % 3600) / 60 ))
}
until_() { # epoch → ↺1h47m ; empty when in the past
    local left=$(( $1 - NOW )); (( left <= 0 )) && return
    (( left < 3600 )) && { printf '↺%dm' $(( left / 60 )); return; }
    printf '↺%dh%dm' $(( left / 3600 )) $(( (left % 3600) / 60 ))
}
pace() { # used% + reset epoch + window seconds → projected end-of-window %, only when over
    # Extrapolates the current burn across the whole window: are you on track to be
    # cut off before it resets? Silent early in a window, where one burst reads as 900%.
    local used=$1 reset=$2 win=$3 now start elapsed proj
    (( used <= 0 || reset <= 0 )) && return
    now=$NOW; start=$(( reset - win )); elapsed=$(( now - start ))
    (( elapsed < win / 10 )) && return
    proj=$(( used * win / elapsed ))
    (( proj > 100 )) && printf '%d' "$proj"
}
kn() { # 25424 → 25.4k
    local n=$1; (( n < 1000 )) && { printf '%d' "$n"; return; }
    printf '%d.%dk' $(( n / 1000 )) $(( (n % 1000) / 100 ))
}

# ── line 1: identity ──────────────────────────────────────────────────────────
l1="${MAG}◆${R} ${GY}${model/ context)/)}${R}"
[ -n "$effort" ] && [ "$effort" != medium ] && l1+="${D} ·${effort}${R}"
[ -n "$thinking" ] && l1+="${D} ·think${R}"
[ -n "$fastmode" ] && l1+="${CYN} ·fast${R}"
[ "$style" != default ] && l1+="${D} ·${style}${R}"

# One porcelain=v2 call yields branch, ahead/behind and dirtiness together.
if gs=$(git -C "${curdir:-.}" status --porcelain=v2 --branch --untracked-files=no 2>/dev/null); then
    branch=$(printf '%s' "$gs" | sed -n 's/^# branch\.head //p')
    ab=$(printf '%s' "$gs" | sed -n 's/^# branch\.ab //p')
    dirty=$(printf '%s\n' "$gs" | grep -qv '^#' && echo 1)
    [ "$branch" = '(detached)' ] && branch=$(git -C "${curdir:-.}" rev-parse --short HEAD 2>/dev/null)
    if [ -n "$branch" ]; then
        l1+="${D}    ${BR}${R}${BLU}${branch}${R}"
        [ -n "$dirty" ] && l1+="${YLW} ✱${R}"
        if [ -n "$ab" ]; then
            a=${ab%% *}; b=${ab##* }
            (( ${a#+} > 0 )) && l1+="${D} ${a#+}↑${R}"
            (( ${b#-} > 0 )) && l1+="${D} ${b#-}↓${R}"
        fi
    fi
fi

[ -n "$reponame" ] || reponame=$(basename "${projdir:-$curdir}" 2>/dev/null)
[ -n "$reponame" ] && l1+="${D}    ${reponame}${R}"
# Only worth saying where you are when it isn't the project root.
if [ -n "$projdir" ] && [ "$curdir" != "$projdir" ] && [ "${curdir#"$projdir"/}" != "$curdir" ]; then
    l1+="${D}/${curdir#"$projdir"/}${R}"
fi

# ── line 2: consumption ───────────────────────────────────────────────────────
l2=''
if (( ctxpct >= 0 )); then
    c=$(heat "$ctxpct"); win=''
    (( ctxsize >= 1000000 )) && win=' 1M'
    l2+="${D}ctx${win} ${R}${c}$(bar "$ctxpct")${R} ${c}${ctxpct}%${R}"
    [ -n "$exceeds" ] && l2+="${RED}!${R}"
fi
if (( h5 >= 0 )); then
    c=$(heat "$h5"); l2+="${D}   5h ${R}${c}$(bar "$h5")${R} ${c}${h5}%${R}"
    (( h5 >= 60 )) && { t=$(until_ "$h5reset"); [ -n "$t" ] && l2+="${D}${t}${R}"; }
    p=$(pace "$h5" "$h5reset" 18000); [ -n "$p" ] && l2+="${RED} ⚠${p}%${R}"
fi
if (( d7 >= 0 )); then
    c=$(heat "$d7"); l2+="${D}   7d ${R}${c}$(bar "$d7")${R} ${c}${d7}%${R}"
    (( d7 >= 60 )) && { t=$(until_ "$d7reset"); [ -n "$t" ] && l2+="${D}${t}${R}"; }
    p=$(pace "$d7" "$d7reset" 604800); [ -n "$p" ] && l2+="${RED} ⚠${p}%${R}"
fi

# No dollar figure: this account bills against the 5h/7d limits above, not per token,
# so spend is already represented by those bars. Elapsed time still frames them.
l2+="${D}   ${R}${GY}$(dur "$durms")${R}"
(( ladd > 0 || lrem > 0 )) && l2+="${D} ${R}${GRN}+${ladd}${R}${D}/${R}${RED}−${lrem}${R}"

# Prompt cache. Going cold silently re-sends the whole conversation on the next turn,
# so the useful moment is BEFORE expiry — a countdown you can act on — not after.
if [ -n "$cachewarm" ]; then
    if (( cacheexp > 0 )); then
        t=$(until_ "$cacheexp")
        if [ -n "$t" ]; then
            (( cacheexp - NOW <= 300 )) && c=$YLW || c=$D
            l2+="${D}   cache ${R}${c}${t}${R}"
        fi
    fi
else
    l2+="${YLW}   cache cold${R}"
    (( recache > 0 )) && l2+="${D} ·$(kn "$recache")${R}"
fi

# ── machine vitals ────────────────────────────────────────────────────────────
# Silent unless the box itself is about to degrade the session. Each of these has
# actually cost a debugging session here: a dGPU that won't sleep, memory pressure
# on a 16 GB machine, and IO stalls that freeze the desktop. All plain sysfs reads.
# Prefer shell builtins — this path runs on every render. Anything a platform cannot
# answer is left empty and simply not printed; no probe is allowed to emit an error.
num() { [ -n "$1" ] && [ -z "${1//[0-9]/}" ]; }   # non-empty and all digits

mac_avail_mb() { # parse `vm_stat` on stdin → MB of reclaimable memory
    # Available ≈ free + inactive + speculative + purgeable, times the page size the
    # header reports (16K on Apple Silicon, 4K on Intel — never hardcode it).
    local ps=0 free=0 inact=0 spec=0 purge=0 line v
    while IFS= read -r line; do
        case $line in
            *'page size of '*) v=${line#*page size of }; ps=${v%% *} ;;
            'Pages free:'*)        v=${line##*:}; free=${v//[^0-9]/} ;;
            'Pages inactive:'*)    v=${line##*:}; inact=${v//[^0-9]/} ;;
            'Pages speculative:'*) v=${line##*:}; spec=${v//[^0-9]/} ;;
            'Pages purgeable:'*)   v=${line##*:}; purge=${v//[^0-9]/} ;;
        esac
    done
    # ps must be >0, not merely numeric: with no vm_stat the loop reads nothing, ps
    # stays 0, and a digits-only test would happily report "0 MB available".
    num "$ps" && [ "$ps" -gt 0 ] || return
    printf '%s' $(( (free + inact + spec + purge) * ps / 1048576 ))
}

vit=''; memav=''
if [ "${SL_VITALS:-1}" = 1 ]; then
case $OSTYPE in
  linux*)
    # A dGPU that refuses to sleep. Glob the nvidia driver's own bindings instead of a
    # fixed PCI address, so this works on any host and stays silent where there is no
    # NVIDIA GPU. D3cold is the healthy state: fully powered off.
    for f in /sys/bus/pci/drivers/nvidia/*/power_state; do
        [ -r "$f" ] || continue
        gpu=''; read -r gpu < "$f"
        [ -n "$gpu" ] && [ "$gpu" != D3cold ] && vit+=" ${YLW}⚡${gpu}${R}"
        break
    done
    while read -r k v _; do
        [ "$k" = MemAvailable: ] && { memav=$(( v / 1024 )); break; }
    done < /proc/meminfo 2>/dev/null
    # /proc/pressure/io line 2 is "full avg10=N.NN ..." — the share of time EVERY task
    # was stalled on IO, i.e. the desktop-freeze signature. PSI needs a kernel built
    # with CONFIG_PSI, so treat a missing or non-numeric value as "no opinion".
    iof=''; { read -r _; read -r _ iof _; } < /proc/pressure/io 2>/dev/null
    iof=${iof#avg10=}; iof=${iof%%.*}
    num "$iof" && (( iof > ${SL_IO_WARN:-15} )) && vit+=" ${RED}⚠io${iof}%${R}"
    ;;
  darwin*)
    # Apple Silicon: unified memory, no discrete GPU to keep awake, and no PSI —
    # so memory is the only vital that means anything here.
    memav=$(vm_stat 2>/dev/null | mac_avail_mb)
    ;;
esac
num "$memav" && (( memav < ${SL_MEM_WARN_MB:-2048} )) && \
    vit+=" ${RED}⚠ram $(( memav / 1024 )).$(( memav % 1024 * 10 / 1024 ))Gi${R}"
fi
[ -n "$vit" ] && l2+="${D}  ${R}${vit}"

# Index freshness. Read from the hooks' own staleness cache rather than recomputed here:
# a status line must never be the thing that runs a git/graph query on every keystroke.
# That also means it is only as current as the last hook run, which the ~ marker admits.
# Absent cache (no gitnexus module, or nothing has run yet) prints nothing at all.
gn="${projdir:-$curdir}/.bearing/.gitnexus-staleness-cache.json"
if [ -f "$gn" ]; then
    IFS=$'\x1f' read -r fresh behindn nodes emb agems <<<"$(
      jq -r '[ (if .data.fresh then "1" else "" end)
             , (.data.commitsBehind // 0)
             , (.data.nodeCount     // 0)
             , (if .data.embeddingsReady then "1" else "" end)
             , (((now * 1000) - (.at // 0)) | floor)
             ] | map(tostring) | join("\u001f")' "$gn" 2>/dev/null)"
    if [ -n "$nodes" ]; then
        # The cache is written by hooks; if none fired recently, say "last known".
        (( agems > 600000 )) && age="${D}~${R}" || age=''
        if [ -z "$emb" ]; then       s="${RED}⚠ no-emb${R}"
        elif [ -n "$fresh" ];  then  s="${GRN}✓${R}"
        elif (( behindn > 0 )); then s="${YLW}⚠ ${behindn} behind${R}"
        else                         s="${YLW}⚠ drift${R}"; fi
        l2+="${D}   ⬢ ${age}idx ${R}${s}${D} · $(kn "$nodes")${R}"
    fi
fi

printf '%s\n%s' "$l1" "$l2"
