on run {slideIndex, pptPath}
	try
		set targetSlideIndex to slideIndex as integer
		if targetSlideIndex < 1 then error "Invalid slide index: " & targetSlideIndex
		
		tell application "Microsoft PowerPoint"
			set pres to missing value
			
			try
				repeat with p in presentations
					if full name of p contains pptPath then
						set pres to p
						exit repeat
					end if
				end repeat
			on error
				set pres to missing value
			end try
			
			if pres is missing value then
				open (POSIX file pptPath)
				set pres to active presentation
			end if
			
			set slideCount to count of slides of pres
			if targetSlideIndex > slideCount then error "Invalid slide index: " & targetSlideIndex
			
			try
				select slide targetSlideIndex of pres
			on error errMsg
				error "Could not activate presentation window for slide " & targetSlideIndex & ": " & errMsg
			end try
			
			activate
			
			set activePres to active presentation
			if full name of activePres does not contain pptPath then error "PowerPoint activated the wrong presentation before starting the slideshow."
			
			set slideShowSettingsRef to slide show settings of activePres
			set advance mode of slideShowSettingsRef to slide show advance use slide timings
			set slideShowWindowRef to run slide show slideShowSettingsRef
			
			if slideShowWindowRef is missing value then error "PowerPoint did not create a slide show window."
			
			try
				go to slide (slideshow view of slideShowWindowRef) number targetSlideIndex
			on error
				-- Some PowerPoint versions already honor starting slide and reject a redundant goto.
			end try
		end tell
		
		return "{\"success\":true}"
	on error errMsg
		return "{\"success\":false,\"error\":\"" & my escapeJson(errMsg) & "\"}"
	end try
end run

on escapeJson(valueText)
	set escapedText to valueText as text
	set escapedText to my replaceText(escapedText, "\\", "\\\\")
	set escapedText to my replaceText(escapedText, "\"", "\\\"")
	set escapedText to my replaceText(escapedText, tab, "\\t")
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
