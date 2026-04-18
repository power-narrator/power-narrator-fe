on run {macroName, pptPath}
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

        try
            run VB macro macro name macroName
        on error errMsg
            return "Error calling macro '" & macroName & "': " & errMsg
        end try
    end tell
end run
