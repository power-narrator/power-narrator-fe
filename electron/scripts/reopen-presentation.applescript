on run argv
    set targetPath to item 1 of argv
    set slideIndex to (item 2 of argv) as integer
    
    tell application "Microsoft PowerPoint"
        open targetPath
        set newPres to active presentation
        try
            select slide slideIndex of newPres
        end try
    end tell
end run
