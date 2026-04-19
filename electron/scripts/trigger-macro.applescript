on run {macroName, pptPath}
    try
        tell application "Microsoft PowerPoint"
            -- activate removed
            
            -- CHECK IF ALREADY OPEN
            set pres to missing value
            try
                repeat with p in presentations
                    if full name of p contains pptPath then
                        set pres to p
                        exit repeat
                    end if
                end repeat
            end try

            if pres is missing value then
                 -- Open if not found
                 open (POSIX file pptPath)
                 set pres to active presentation
            else
                 -- Use existing
            end if

            run VB macro macro name macroName
        end tell

        return "{\"success\":true}"
    on error errMsg
        return "{\"success\":false,\"message\":\"" & my escapeJson("Error calling macro '" & macroName & "': " & errMsg) & "\"}"
    end try
end run

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
