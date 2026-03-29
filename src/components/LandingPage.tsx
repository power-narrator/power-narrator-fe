import { Text, Button } from "@mantine/core";

interface LandingPageProps {
  onSelectFile?: () => void;
}

export function LandingPage({ onSelectFile }: LandingPageProps) {
  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
      }}
    >
      <Button onClick={onSelectFile} size="xl" variant="filled" color="blue">
        Select PowerPoint File
      </Button>
      <Text c="dimmed" mt="md">
        Select a .pptx file to begin
      </Text>
    </div>
  );
}
