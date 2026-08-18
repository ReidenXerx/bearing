# bearing — terminal recording
#
# Rendered with VHS (Charm):  https://github.com/charmbracelet/vhs
#   brew install vhs
#   then:  vhs docs/social/bearing.tape
#
# Output: docs/social/bearing.gif
#
# The narrative + timing live in docs/social/scene.sh, which prints with 24-bit ANSI codes
# matching the bearing palette. VHS `Type` would type plain uncoloured characters, so the
# tape runs the script instead and waits for it to finish.

Output "docs/social/bearing.gif"

Set Width 900
Set Height 560
Set FontSize 18
Set Padding 24
Set Theme "Dracula"

# Run the scene; it carries its own sleeps and clears. No typing here.
Type "bash docs/social/scene.sh"
Enter

# Give the script time to play out, then hold the final frame.
Sleep 12s
