on run argv
    set targetPath to item 1 of argv
    set targetSlideIndex to 1
    
    tell application "Microsoft PowerPoint"
        set presCount to count presentations
        repeat with i from 1 to presCount
            set pres to presentation i
            set presPath to full name of pres
            if presPath = targetPath then
                -- Get current slide index
                try
                    set theSelection to selection of document window 1
                    set targetSlideIndex to slide index of slide 1 of slide range of theSelection
                end try
                
                save pres
                close pres
                return targetSlideIndex
            end if
        end repeat
    end tell
    
    return targetSlideIndex
end run
