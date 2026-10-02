on run {outputPath, pptPath}
    tell application "Microsoft PowerPoint"
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
             if pptPath is not "" then
                open (POSIX file pptPath)
                set pres to active presentation
             else
                if exists active presentation then
                    set pres to active presentation
                end if
             end if
        end if
        
        if pres is missing value then
            return "Error: No active presentation to export."
        end if
        
        try
            save pres in (POSIX file outputPath) as save as movie
        on error errMsg
            return "Error initiating export: " & errMsg
        end try
        
    end tell
    
    set stableCount to 0
    set lastSize to -1
    set waitCycles to 0
    set maxInitialWait to 30 -- Wait up to 30s for file to APPEAR
    set maxStableWait to 600 -- Wait up to 10 mins for export
    
    repeat while waitCycles < maxInitialWait
        try
            do shell script "ls " & quoted form of outputPath
            exit repeat
        on error
        end try
        delay 1
        set waitCycles to waitCycles + 1
    end repeat
    
    if waitCycles >= maxInitialWait then
        return "Error: Timeout waiting for video file to be created."
    end if
    
    set isBusy to true
    set waitCycles to 0
    
    repeat while isBusy and waitCycles < maxStableWait
        delay 2
        set waitCycles to waitCycles + 2
        
        try
            do shell script "lsof " & quoted form of outputPath
            set isBusy to true
        on error
            set isBusy to false
        end try
    end repeat
    
    if isBusy then
         return "Error: Timeout. PowerPoint is still holding the file open."
    end if
    
    return "Success"
end run
