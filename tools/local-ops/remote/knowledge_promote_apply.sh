#!/bin/sh
# Fail closed: knowledge.promote.apply compute is win-host (CHG-026).
# Gateway must use the knowledge adapter, not this ssh recipe.
echo '{"ok":false,"error":"knowledge.promote.apply is win-host only"}' >&2
exit 2
