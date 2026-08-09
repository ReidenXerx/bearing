### Anchored spawn — how to send work out

A subagent starts with **none of your context**. That is what makes it cheap and what makes it
drift, so everything below exists to give it back exactly enough and no more.

**1. Persona.** Read `.bearing/domain.json` and give every subagent the SAME pinned persona bearing
resolved at install. Same in wave 2 as in wave 1, same in every unit of a fan-out — an expert that
changes between agents produces findings you cannot compare.

**2. Anchor.** Include the north-stars this task could actually violate — the relevant subset, not
the whole file. A subagent that never sees them will confidently contradict a settled decision, and
one that sees all of them pays that token cost once per agent.

**3. Bounds.** State the unit, what to return, and **what NOT to decide**. Whatever you leave
unstated, a subagent will decide anyway, using context it does not have.

**4. Parallel where the runtime allows it**, sequential where it does not. Claude Code can run them
concurrently; treat that as an optimisation, never as a requirement — the routine must produce the
same answer either way.

**5. Coverage is a claim, so keep it honest.** A subagent that died, timed out, or came back
empty-but-confused has REDUCED YOUR COVERAGE, and silence reads as "I checked everything". Re-run
it, or say plainly what went unchecked. Never let the count of agents you spawned stand in for the
count that actually reported.

**6. Spot-check before you trust.** Open at least one cited `file:line` per subagent and confirm it
says what the report claims. A fabricated citation is the one failure the return shape cannot catch
on its own.
