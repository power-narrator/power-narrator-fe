on run {slideIndex, pptPath}
	try
		set targetSlideIndex to slideIndex as integer
		if targetSlideIndex < 1 then error "Invalid slide index: " & targetSlideIndex
		
		tell application "Microsoft PowerPoint"
			set targetName to do shell script "basename " & quoted form of pptPath
			set targetWindowIndex to my findTargetWindowIndex(pptPath, targetName)
			if targetWindowIndex is 0 then
				open (POSIX file pptPath)
				set targetWindowIndex to my findTargetWindowIndex(pptPath, targetName)
			end if
			
			if targetWindowIndex is 0 then error "Could not find a document window for the target presentation."
			
			select document window targetWindowIndex
			activate document window targetWindowIndex
			set pres to active presentation
			
			if full name of pres is not pptPath and name of pres is not targetName then error "PowerPoint activated the wrong presentation before starting the slideshow."
			
			set slideCount to count of slides of pres
			if targetSlideIndex > slideCount then error "Invalid slide index: " & targetSlideIndex
			
			try
				select slide targetSlideIndex of pres
			on error errMsg
				error "Could not activate presentation window for slide " & targetSlideIndex & ": " & errMsg
			end try
			
			activate
			set slideShowSettingsRef to slide show settings of pres
			set starting slide of slideShowSettingsRef to targetSlideIndex
			set ending slide of slideShowSettingsRef to slideCount
			set advance mode of slideShowSettingsRef to slide show advance use slide timings
			set slideShowWindowRef to run slide show slideShowSettingsRef
			
			if slideShowWindowRef is missing value then error "PowerPoint did not create a slide show window."
		end tell
		
		return "{\"success\":true}"
	on error errMsg
		return "{\"success\":false,\"message\":\"" & my escapeJson(errMsg) & "\"}"
	end try
end run

on findTargetWindowIndex(pptPath, targetName)
	tell application "Microsoft PowerPoint"
		repeat with i from 1 to count of document windows
			try
				set windowPres to presentation of document window i
				if full name of windowPres is pptPath or name of windowPres is targetName then
					return i
				end if
			on error
			end try
		end repeat
	end tell
	
	return 0
end findTargetWindowIndex

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
