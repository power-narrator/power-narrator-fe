on run {slideIndex, pptPath}
	set slideIndex to slideIndex as string
	
	-- 1. Write Slide Index and Path to File
	-- This file is read by the VBA macro 'PlaySlide'
	set paramPath to (path to library folder from user domain as string) & "Group Containers:UBF8T346G9.Office:play_slide_params.txt"
	set posixParamPath to POSIX path of paramPath
	
	set fileContent to pptPath & "|" & slideIndex
	
	try
		do shell script "echo " & quoted form of fileContent & " > " & quoted form of posixParamPath
	on error errMsg
		return "Error writing play_slide_params.txt: " & errMsg
	end try
	
	-- 2. Trigger the Macro
	tell application "Microsoft PowerPoint"
		-- Focus the specific presentation
		set pres to missing value
		try
			repeat with p in presentations
				if full name of p contains pptPath then
					set pres to p
					exit repeat
				end if
			end repeat
		end try
		
		if pres is not missing value then
			activate
			-- PowerPoint doesn't have a direct "bring presentation to front" command easily, 
			-- but activating and having the macro target it works.
		end if
		try
			-- Try running with the specific add-in syntax
			run VB macro macro name "AudioTools.ppam!PlaySlide"
		on error errMsg1
			try
				-- Fallback to simple name (if imported as module)
				run VB macro macro name "PlaySlide"
			on error errMsg2
				return "Error running macro: " & errMsg1 & " // " & errMsg2
			end try
		end try
	end tell
	
end run
