use scripting additions

on run argv
	if (count of argv) < 3 then
		error "Usage: sync-slide.applescript <pptPath> <slideIndex> <outputDir>"
	end if
	
	set pptPath to item 1 of argv
	set slideIndex to (item 2 of argv) as integer
	set outputDir to item 3 of argv
	set slidesDir to outputDir & "/slides"
	
	-- Construct output filenames
	set slideName to "Slide" & slideIndex & ".png"
	set slidePathPosix to slidesDir & "/" & slideName
	
	-- 1. Prepare Parameters for VBA (Shared File)
	-- Do this OUTSIDE of PowerPoint tell block to avoid terminology conflicts
	set homePath to (path to home folder as text)
	set containerPath to homePath & "Library:Group Containers:UBF8T346G9.Office:"
    set containerPosix to POSIX path of containerPath
    
	set paramsPath to containerPath & "reload_slide.txt"
    
    -- Use Sandbox for intermediate image to avoid "Grant Access" prompts
    set sandboxImageName to "temp_slide_" & slideIndex & ".png"
    set sandboxImagePosix to containerPosix & sandboxImageName
	
    -- Pass the Sandbox path and PPT path to VBA
	set paramString to (slideIndex as text) & "|" & sandboxImagePosix & "|" & pptPath
	
	do shell script "echo " & quoted form of paramString & " > " & quoted form of (POSIX path of paramsPath)
	
	-- 2. Open PPT and Run Macro
    set notesText to ""
	tell application "Microsoft PowerPoint"
		activate
		
		-- Check/Open Presentation
        -- We try to find it first
        set presFound to false
        set presName to ""
        
        try
            -- Simple check if active presentation matches
            if (count of presentations) > 0 then
                if full name of active presentation contains pptPath then
                   set presFound to true
                   set presName to name of active presentation
                end if
            end if
        end try
        
        if not presFound then
             -- Loop check
             repeat with p in presentations
                if full name of p contains pptPath then
                    set presFound to true
                    set presName to name of p
                    exit repeat
                end if
             end repeat
        end if
        
        if not presFound then
            open (POSIX file pptPath)
            set presFound to true
            set presName to name of active presentation
        end if
        
        -- Run Export Macro
		try
            -- Run the macro which reads the text file we just wrote
			run VB macro macro name "ReloadSlide"
		on error errMsg
             error "VBA Macro Failed: " & errMsg
		end try
        
        -- Get Notes from the specific presentation
        try
            tell slide slideIndex of presentation presName
                tell notes page
                    if (count of shapes) > 1 then
                        set notesText to content of text range of text frame of shape 2
                    end if
                end tell
            end tell
        on error
            set notesText to ""
        end try
        
	end tell
	
	-- 3. Move File from Sandbox to Final Destination
    -- OUTSIDE of PPT tell block
	delay 0.5
	
    -- Wait for sandbox file
    set sandboxFileExists to false
	repeat with loopVar from 1 to 20
		tell application "System Events"
			if exists file sandboxImagePosix then 
                set sandboxFileExists to true
                exit repeat
            end if
		end tell
		delay 0.1
	end repeat
    
    if sandboxFileExists then
        -- Move it to final destination (overwrite if exists)
        do shell script "mv -f " & quoted form of sandboxImagePosix & " " & quoted form of slidePathPosix
    else
        return "Error: VBA did not create file at " & sandboxImagePosix
    end if
	
	-- Return Format: ImageRelPath|||Notes
	set safeNotes to my cleanNotes(notesText)
	return "slides/" & slideName & "|||" & safeNotes
	
end run

-- Helper to ensure POSIX path rules
on coveredPOSIXPath(thePath)
    -- Just return the path, usually fine.
    return thePath
end coveredPOSIXPath

on cleanNotes(str)
    if str is missing value then return ""
    set str to str as text
    set text item delimiters to "|||"
    set itemsList to text items of str
    set text item delimiters to "   " 
    set str to itemsList as text
    
    set text item delimiters to (return & linefeed)
    set itemsList to text items of str
    set text item delimiters to "\\n"
    set str to itemsList as text
    
    set text item delimiters to return
    set itemsList to text items of str
    set text item delimiters to "\\n"
    set str to itemsList as text
    
    set text item delimiters to linefeed
    set itemsList to text items of str
    set text item delimiters to "\\n"
    set str to itemsList as text
    
    -- Handle Vertical Tab (ASCII 11) used by PowerPoint for soft returns (Shift+Enter)
    set text item delimiters to (character id 11)
    set itemsList to text items of str
    set text item delimiters to "\\n"
    set str to itemsList as text
    
    -- Handle Unicode Line Separator (U+2028) used by PowerPoint on Mac
    set text item delimiters to (character id 8232)
    set itemsList to text items of str
    set text item delimiters to "\\n"
    set str to itemsList as text
    
    -- Handle Unicode Paragraph Separator (U+2029)
    set text item delimiters to (character id 8233)
    set itemsList to text items of str
    set text item delimiters to "\\n"
    set str to itemsList as text
    
    -- Replace smart quotes and dashes to prevent encoding issues
    set text item delimiters to "’"
    set itemsList to text items of str
    set text item delimiters to "'"
    set str to itemsList as text
    
    set text item delimiters to "‘"
    set itemsList to text items of str
    set text item delimiters to "'"
    set str to itemsList as text
    
    set text item delimiters to "“"
    set itemsList to text items of str
    set text item delimiters to "\""
    set str to itemsList as text
    
    set text item delimiters to "”"
    set itemsList to text items of str
    set text item delimiters to "\""
    set str to itemsList as text
    
    set text item delimiters to "–" -- En dash
    set itemsList to text items of str
    set text item delimiters to "-"
    set str to itemsList as text
    
    set text item delimiters to "—" -- Em dash
    set itemsList to text items of str
    set text item delimiters to "--"
    set str to itemsList as text

    return str
end cleanNotes
