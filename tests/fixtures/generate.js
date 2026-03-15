import pptxgen from 'pptxgenjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createFixture() {
    let pres = new pptxgen();

    // Slide 1
    let slide1 = pres.addSlide();
    slide1.addText('Slide 1 Content', { x: 1, y: 1, w: 8, h: 2, fontSize: 36, align: 'center' });
    slide1.addNotes('Initial notes for slide 1');

    // Slide 2
    let slide2 = pres.addSlide();
    slide2.addText('Slide 2 Content', { x: 1, y: 1, w: 8, h: 2, fontSize: 36, align: 'center' });
    slide2.addNotes('Initial notes for slide 2');

    const fixturePath = path.join(__dirname, 'test-presentation.pptx');
    await pres.writeFile({ fileName: fixturePath });
    console.log(`Created fixture at ${fixturePath}`);
}

createFixture().catch(console.error);
