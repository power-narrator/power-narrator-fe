-- "target-window": the macro needs the presentation's window active, which PowerPoint switches to
-- only while frontmost, so PowerPoint is brought forward only when another presentation is active.
-- data.previousApp is the app it was brought in front of.
on run argv
    set macroName to item 1 of argv
    set pptPath to item 2 of argv
    set needsTargetWindow to (count of argv) > 2 and item 3 of argv is "target-window"
    set launchData to "{}"
    try
        tell application "Microsoft PowerPoint"
            set openPaths to full name of every presentation
            if openPaths is missing value then set openPaths to {}
            -- Opening an open presentation raises its window.
            if openPaths does not contain pptPath then open (POSIX file pptPath)

            if needsTargetWindow and full name of active presentation is not pptPath then
                if not frontmost then
                    set launchData to "{\"previousApp\":\"" & my escapeJson(my frontmostAppPath()) & "\"}"
                end if
                activate
            end if

            run VB macro macro name macroName
        end tell

        return "{\"success\":true,\"data\":" & launchData & "}"
    on error errMsg
        return "{\"success\":false,\"message\":\"" & my escapeJson("Error calling macro '" & macroName & "': " & errMsg) & "\",\"data\":" & launchData & "}"
    end try
end run

on frontmostAppPath()
    return POSIX path of (path to frontmost application)
end frontmostAppPath

on escapeJson(valueText)
    set escapedText to valueText as text
    set escapedText to my replaceText(escapedText, "\\", "\\\\")
    set escapedText to my replaceText(escapedText, "\"", "\\\"")
    set escapedText to my replaceText(escapedText, return & linefeed, "\\n")
    set escapedText to my replaceText(escapedText, return, "\\n")
    set escapedText to my replaceText(escapedText, linefeed, "\\n")
    return escapedText
end escapeJson

on replaceText(sourceText, findText, replaceWith)
    set oldDelimiters to AppleScript's text item delimiters
    set AppleScript's text item delimiters to findText
    set textItems to text items of sourceText
    set AppleScript's text item delimiters to replaceWith
    set replacedText to textItems as text
    set AppleScript's text item delimiters to oldDelimiters
    return replacedText
end replaceText
