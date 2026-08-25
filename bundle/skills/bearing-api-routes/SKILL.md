---
name: bearing-api-routes
description: "HTTP API route changes. Use api_impact/route_map/shape_check on framework routers (Express/Fastify/Hono/Next); use graph tools on dispatcher symbols when the project has a custom hand-rolled router (no indexed Route nodes). Examples: add endpoint, change route, trace handler + consumers."
---

# API Routes

## The graph can be wrong

A zero is not absence; a near-0.5 `r.confidence` edge is a lead, not proof (~92% of `USES`); a count
can be a floor — `impact` says which in `epistemic`. Before a conclusion that matters, confirm with a
scoped `Grep` (allowed here, not a gate violation) and say which check you ran.


The kit auto-detects the router style at install and writes `.bearing/gitnexus-api-profile.json`.
Run `npm run bearing:detect-api` to refresh it after major server changes. Route the work by profile.

| Profile | What it means | Use |
| --- | --- | --- |
| `framework` | Indexed `Route` nodes exist | `api_impact` → `route_map` → `shape_check` |
| `framework-likely` | Framework imports seen, no Route nodes yet | Try `api_impact`; if empty after refresh, treat as custom |
| `custom` | Hand-rolled dispatcher, zero Route nodes | Graph tools on dispatcher symbols (below) |
| `none` | No HTTP layer detected | Skip API tooling |

## Framework routers (Express / Fastify / Hono / Next route handlers)

```
1. gitnexus_api_impact({ route: "/api/<path>", repo: "__GITNEXUS_REPO__" })   # consumers + shape + risk
2. gitnexus_route_map({ route: "/api/<path>" })                                # handler + middleware chain
3. gitnexus_shape_check({ route: "/api/<path>" })                              # response keys vs consumer access
4. gitnexus_impact upstream on the handler symbol BEFORE editing
5. gitnexus_detect_changes before commit
```

`api_impact` is the one-stop pre-change report — prefer it over calling the three separately.

## Custom hand-rolled router (no indexed Route nodes)

When `api_impact` / `route_map` return zero routes, the project dispatches HTTP itself. Use the graph on
the dispatcher + handler symbols instead of Route tooling.

```
1. gitnexus_query({
     search_query: "<path or feature> request handler",
     task_context: "API route change",
     goal: "find dispatcher + handler + response envelope"
   })
2. gitnexus_context({ name: "<dispatcher symbol>" })   # e.g. the request router / matcher
3. gitnexus_context({ name: "<the specific handler>" })
4. gitnexus_impact upstream on the handler BEFORE editing
5. Update any client/consumer that mirrors the response shape (typed API client, SDK)
6. gitnexus_detect_changes before commit
```

Find the dispatcher symbol from the profile's `sourceSignals.customSymbols` (nested, not top-level), or query for "request handler / router / dispatch".

## Checklist

```
- [ ] Profile checked (.bearing/gitnexus-api-profile.json or npm run bearing:detect-api)
- [ ] context on dispatcher (custom) OR api_impact (framework)
- [ ] impact upstream on the handler symbol
- [ ] Response envelope / schema preserved (or consumers updated in the same change)
- [ ] Client/SDK types match the new payload shape
- [ ] gitnexus_detect_changes before commit; tests for affected processes green
```

## Finding consumers

```
gitnexus_shape_check({ route: "/api/<path>" })          # framework: keys returned vs keys accessed
gitnexus_query({ search_query: "<endpoint> fetch client", goal: "find consumer" })   # custom: trace the caller
gitnexus_context({ name: "<handler>" })                 # incoming edges = who depends on it
```

Grep is appropriate for URL string literals in a typed API client when you already know the file.
