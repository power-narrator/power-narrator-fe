use scripting additions

on run argv
	try
		if (count of argv) < 2 then
			error "Usage: convert-mac.applescript <inputPath> <outputDir>"
		end if
		
		set inputPath to item 1 of argv
		set outputDir to item 2 of argv
		set slidesDir to outputDir & "/slides"
		
		do shell script "mkdir -p " & quoted form of outputDir
		do shell script "rm -rf " & quoted form of slidesDir
		do shell script "mkdir -p " & quoted form of slidesDir
		
		tell application "Microsoft PowerPoint"
			launch -- Start without activating/stealing focus
			
			set pres to missing value
			try
				repeat with p in presentations
					if full name of p contains inputPath then
						set pres to p
						exit repeat
					end if
				end repeat
			end try
			
			if pres is missing value then
				open (POSIX file inputPath)
				set pres to active presentation
			end if
			
			activate
			try
				select slide 1 of pres
			end try
			
			set slideCount to count of slides of pres
			
			try
				set slidesHFS to (POSIX file slidesDir) as text
			on error
				set slidesHFS to slidesDir
			end try
			
			if slidesHFS does not end with ":" then
				set slidesHFS to slidesHFS & ":"
			end if
			
			set ts to (time of (current date)) as string
			
			repeat with i from 1 to slideCount
				set slideName to "Slide_" & i & "_" & ts & ".png"
				set slidePathPosix to slidesDir & "/" & slideName
				set slidePathHFS to slidesHFS & slideName as text
				
				try
					tell slide i of pres
						save in slidePathHFS as save as PNG
					end tell
				on error
					try
						tell slide i of pres
							copy object
						end tell
						delay 0.2
						
						set pngData to the clipboard as «class PNGf»
						set fRef to open for access (POSIX file slidePathPosix) with write permission
						set eof fRef to 0
						write pngData to fRef
						close access fRef
					on error
						try
							close access (POSIX file slidePathPosix)
						end try
					end try
				end try
			end repeat
			
			set imageData to {}
			
			repeat with i from 1 to slideCount
				set slideNum to i
				set bestName to "Slide_" & slideNum & "_" & ts & ".png"
				set imageRelPath to ""
				
				if (do shell script "[ -f " & quoted form of (slidesDir & "/" & bestName) & " ] && echo 'yes' || echo 'no'") is "yes" then
					set imageRelPath to "slides/" & bestName
				else
					try
						set foundFile to do shell script "ls " & quoted form of slidesDir & " | grep -i '^Slide_" & slideNum & "_.*\\.png$'"
						set foundFile to paragraph 1 of foundFile
						set imageRelPath to "slides/" & foundFile
					on error
						set imageRelPath to ""
					end try
				end if
				
				set dataItem to (slideNum as text) & "|||" & imageRelPath
				copy dataItem to end of imageData
			end repeat
		end tell
		
		set manifestPath to outputDir & "/images.json"
		set inputData to my joinList(imageData, linefeed)
		set tempPath to outputDir & "/temp_images.txt"
		
		try
			set fileRef to open for access (POSIX file tempPath) with write permission
			set eof fileRef to 0
			write inputData to fileRef as «class utf8»
			close access fileRef
		on error
			do shell script "echo " & quoted form of inputData & " > " & quoted form of tempPath
		end try
		
		set perlScript to "use JSON::PP; use strict; use warnings; " & ¬
			"open(my $fh, '<:encoding(UTF-8)', $ARGV[0]) or die $!; " & ¬
			"my @slides; " & ¬
			"while(<$fh>) { chomp; next unless /\\|\\|\\|/; my ($idx, $img) = split(/\\|\\|\\|/, $_, 2); next unless defined $idx && $idx =~ /^\\d+$/; $img = '' unless defined $img; push @slides, { index => $idx + 0, image => $img }; } " & ¬
			"close($fh); " & ¬
			"open(my $out, '>:encoding(UTF-8)', $ARGV[1]) or die $!; " & ¬
			"print $out encode_json(\\@slides); " & ¬
			"close($out);"
		
		do shell script "perl -e " & quoted form of perlScript & " -- " & quoted form of tempPath & " " & quoted form of manifestPath
		
		try
			do shell script "rm " & quoted form of tempPath
		end try
		
		return my jsonSuccess("manifestPath", manifestPath)
	on error errMsg
		return my jsonError(errMsg)
	end try
end run

on joinList(theList, theDelimiter)
	set AppleScript's text item delimiters to theDelimiter
	set joinedText to theList as text
	set AppleScript's text item delimiters to ""
	return joinedText
end joinList

on jsonSuccess(keyName, valueText)
	return "{\"success\":true,\"data\":{\"" & keyName & "\":\"" & my escapeJson(valueText) & "\"}}"
end jsonSuccess

on jsonError(messageText)
	return "{\"success\":false,\"error\":\"" & my escapeJson(messageText) & "\"}"
end jsonError

on escapeJson(valueText)
	set escapedText to valueText as text
	set escapedText to my replaceText(escapedText, "\\", "\\\\")
	set escapedText to my replaceText(escapedText, "\"", "\\\"")
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
