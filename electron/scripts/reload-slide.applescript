use scripting additions

on run argv
	if (count of argv) < 3 then
		error "Usage: reload-slide.applescript <pptPath> <slideIndex> <outputDir>"
	end if
	
	set pptPath to item 1 of argv
	set slideIndex to (item 2 of argv) as integer
	set outputDir to item 3 of argv
	set slidesDir to outputDir & "/slides"
	set slideName to "Slide" & slideIndex & ".png"
	set slidePathPosix to slidesDir & "/" & slideName
	
	do shell script "mkdir -p " & quoted form of slidesDir
	
	tell application "Microsoft PowerPoint"
		launch
		
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
			open (POSIX file pptPath)
			try
				set window state of active window to minimized
			end try
			set pres to active presentation
		end if
		
		try
			set slidesHFS to (POSIX file slidesDir) as text
		on error
			set slidesHFS to slidesDir
		end try
		
		if slidesHFS does not end with ":" then
			set slidesHFS to slidesHFS & ":"
		end if
		
		try
			set slidePathHFS to slidesHFS & slideName as text
			tell slide slideIndex of pres
				save in slidePathHFS as save as PNG
			end tell
		on error
			try
				tell slide slideIndex of pres
					copy object
				end tell
				delay 0.2
				
				set pngData to the clipboard as «class PNGf»
				set fRef to open for access (POSIX file slidePathPosix) with write permission
				set eof fRef to 0
				write pngData to fRef
				close access fRef
			on error errMsg
				try
					close access (POSIX file slidePathPosix)
				end try
				error "Failed to export slide image: " & errMsg
			end try
		end try
	end tell
	
	return "slides/" & slideName
end run
