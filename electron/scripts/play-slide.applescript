on run {slideIndex, pptPath}
	set slideIndex to slideIndex as string
	
	-- 1. Write Slide Index and Path to File
	-- This file is read by the VBA macro 'PlaySlide'
	set paramPath to (path to library folder from user domain as string) & "Group Containers:UBF8T346G9.Office:play_slide.txt"
	set posixParamPath to POSIX path of paramPath
	
	set fileContent to slideIndex & "|" & pptPath
	
	try
		do shell script "echo " & quoted form of fileContent & " > " & quoted form of posixParamPath
	on error errMsg
		return "Error writing play_slide.txt: " & errMsg
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
			-- Bring PowerPoint to the front before running macro
			-- activate
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

		-- Force PowerPoint to the front again after starting the show
		-- to ensure the Slide Show window is active and not behind the navbar.
		-- activate
		tell application "System Events"
			set frontmost of process "Microsoft PowerPoint" to true
		end tell
	end tell
	
end run
