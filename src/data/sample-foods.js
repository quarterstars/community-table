// Specific fictional recipes, not claims about every version of these dishes.
// English fields remain compatible with existing listings; Amharic is optional.
const organization = 'Community Table Sample Kitchen';
const image = '/images/food-placeholder.svg';
const photos = require('./food-photos.json');
function sample(fields, am) {
  const photo = photos.find(photo => photo.listingId === fields.id);
  return { organization, category: 'Sample food', image, imageType: 'placeholder', imageAlt: 'Neutral food placeholder; no photograph is available', availablePortions: 8,
    pickupLocation: 'Sample Kitchen · fictional welcome table', ...fields,
    ...(photo ? { image: photo.image, imageType: 'photo', imageAlt: photo.imageAlt } : {}),
    translations: { am: { organization: 'የኮሚዩኒቲ ቴብል ምሳሌ ወጥ ቤት', category: 'የምግብ ምሳሌ', imageAlt: 'የምግብ ፎቶ የለም፤ ገለልተኛ የቦታ ያዥ ምስል', pickupLocation: 'የምሳሌ ወጥ ቤት፤ የምሳሌ መቀበያ ጠረጴዛ', ...am, ...(photo ? { imageAlt: photo.amImageAlt } : {}) } } };
}
const sampleFoods = [
  sample({
    id: 'sample-doro-wat', name: 'Doro wat',
    description: 'Sample chicken stew with slowly cooked onions, berbere, spiced clarified butter and a hard-boiled egg. This example portion does not include injera.',
    portionSize: 'One chicken drumstick, one hard-boiled egg and ½ cup of stew sauce in one container.',
    ingredients: ['Chicken drumstick', 'Egg', 'Onion', 'Garlic', 'Ginger', 'Niter kibbeh (clarified milk butter, cardamom and cinnamon)', 'Berbere (chili, paprika, coriander and fenugreek)', 'Water', 'Salt'],
    allergens: 'This sample recipe contains egg and milk (in the niter kibbeh). Cross-contact information is unknown. No injera is included in this portion.',
    pickupInstructions: 'Example only: show your pickup code at the fictional welcome table and collect one sealed chicken-and-egg container per portion. No real pickup is offered.'
  }, {
    name: 'ዶሮ ወጥ',
    description: 'ይህ የምሳሌ ዶሮ ወጥ በቀስታ በበሰለ ሽንኩርት፣ በበርበሬ፣ በንጥር ቅቤ እና በተቀቀለ እንቁላል ይዘጋጃል። በዚህ ድርሻ እንጀራ አይካተትም።',
    portionSize: 'በአንድ ዕቃ ውስጥ አንድ የዶሮ እግር፣ አንድ የተቀቀለ እንቁላል እና ግማሽ ኩባያ የወጥ ሾርባ።',
    ingredients: ['የዶሮ እግር', 'እንቁላል', 'ሽንኩርት', 'ነጭ ሽንኩርት', 'ዝንጅብል', 'ንጥር ቅቤ (የወተት ቅቤ፣ ሄል እና ቀረፋ)', 'በርበሬ (ቃሪያ፣ ፓፕሪካ፣ ድንብላል እና አብሽ)', 'ውሃ', 'ጨው'],
    allergens: 'ይህ የምሳሌ አዘገጃጀት እንቁላል እና ወተት (በንጥር ቅቤ ውስጥ) ይዟል። ከሌሎች ምግቦች ጋር የመነካካት መረጃ አይታወቅም። እንጀራ አይካተትም።',
    pickupInstructions: 'ምሳሌ ብቻ፦ በምሳሌው መቀበያ ጠረጴዛ ኮድዎን ያሳዩ፤ ለእያንዳንዱ ድርሻ አንድ የታሸገ ዶሮና እንቁላል ዕቃ ይውሰዱ። እውነተኛ የምግብ መውሰድ አገልግሎት የለም።'
  }),
  sample({
    id: 'sample-misir-wot-injera', name: 'Misir wot with injera',
    description: 'Sample red-lentil stew made with onion, tomato, olive oil and berbere, served with teff-and-wheat injera. This example uses oil rather than butter.',
    portionSize: 'One cup of lentil stew and one 10-inch injera, packed separately.',
    ingredients: ['Red lentils', 'Onion', 'Tomato', 'Garlic', 'Ginger', 'Olive oil', 'Berbere (chili, paprika and fenugreek)', 'Salt', 'Water', 'Injera (teff flour, wheat flour and fermented teff-and-wheat starter)'],
    allergens: 'Contains wheat in this sample injera; it is not gluten-free. No milk or egg is used in this specified recipe. Cross-contact information is unknown.',
    pickupInstructions: 'Example only: show your pickup code at the fictional welcome table. Collect one sealed lentil container and one separately wrapped injera per portion. No real pickup is offered.'
  }, {
    name: 'ምስር ወጥ ከእንጀራ ጋር',
    description: 'ይህ የምሳሌ ቀይ ምስር ወጥ በሽንኩርት፣ በቲማቲም፣ በወይራ ዘይት እና በበርበሬ ይዘጋጃል። ከጤፍና ከስንዴ ዱቄት ከተዘጋጀ እንጀራ ጋር ይቀርባል። ቅቤ አይጠቀምም።',
    portionSize: 'አንድ ኩባያ ምስር ወጥ እና አንድ 10 ኢንች እንጀራ፤ በተለያዩ ዕቃዎች ይታሸጋሉ።',
    ingredients: ['ቀይ ምስር', 'ሽንኩርት', 'ቲማቲም', 'ነጭ ሽንኩርት', 'ዝንጅብል', 'የወይራ ዘይት', 'በርበሬ (ቃሪያ፣ ፓፕሪካ እና አብሽ)', 'ጨው', 'ውሃ', 'እንጀራ (የጤፍ ዱቄት፣ የስንዴ ዱቄት እና የጤፍና የስንዴ እርሾ)'],
    allergens: 'የዚህ ምሳሌ እንጀራ ስንዴ ይዟል፤ ከግሉተን ነፃ አይደለም። በዚህ አዘገጃጀት ወተትና እንቁላል አይጠቀሙም። ከሌሎች ምግቦች ጋር የመነካካት መረጃ አይታወቅም።',
    pickupInstructions: 'ምሳሌ ብቻ፦ በምሳሌው መቀበያ ጠረጴዛ ኮድዎን ያሳዩ፤ ለእያንዳንዱ ድርሻ አንድ የታሸገ ምስር ወጥ እና ለብቻ የተጠቀለለ እንጀራ ይውሰዱ። እውነተኛ መውሰድ አገልግሎት የለም።'
  }),
  sample({
    id: 'sample-atkilt-wot-injera', name: 'Atkilt wot with injera',
    description: 'Sample cabbage, potato and carrot stew seasoned with turmeric, garlic and onion, cooked in canola oil. Served with teff-and-wheat injera; this recipe does not use berbere or butter.',
    portionSize: 'One cup of vegetable stew and one 10-inch injera, packed separately.',
    ingredients: ['Cabbage', 'Potato', 'Carrot', 'Onion', 'Garlic', 'Turmeric', 'Canola oil', 'Salt', 'Water', 'Injera (teff flour, wheat flour and fermented teff-and-wheat starter)'],
    allergens: 'Contains wheat in this sample injera; it is not gluten-free. No milk or egg is used in this specified recipe. Cross-contact information is unknown.',
    pickupInstructions: 'Example only: show your pickup code at the fictional welcome table. Collect one sealed vegetable container and one separately wrapped injera per portion. No real pickup is offered.'
  }, {
    name: 'አትክልት ወጥ ከእንጀራ ጋር',
    description: 'ይህ የምሳሌ የጎመን፣ የድንችና የካሮት ወጥ በእርድ፣ በነጭ ሽንኩርትና በሽንኩርት ተቀምሞ በካኖላ ዘይት ይበስላል። ከጤፍና ከስንዴ እንጀራ ጋር ይቀርባል፤ በርበሬና ቅቤ አይጠቀምም።',
    portionSize: 'አንድ ኩባያ አትክልት ወጥ እና አንድ 10 ኢንች እንጀራ፤ በተለያዩ ዕቃዎች ይታሸጋሉ።',
    ingredients: ['ጎመን', 'ድንች', 'ካሮት', 'ሽንኩርት', 'ነጭ ሽንኩርት', 'እርድ', 'የካኖላ ዘይት', 'ጨው', 'ውሃ', 'እንጀራ (የጤፍ ዱቄት፣ የስንዴ ዱቄት እና የጤፍና የስንዴ እርሾ)'],
    allergens: 'የዚህ ምሳሌ እንጀራ ስንዴ ይዟል፤ ከግሉተን ነፃ አይደለም። በዚህ አዘገጃጀት ወተትና እንቁላል አይጠቀሙም። ከሌሎች ምግቦች ጋር የመነካካት መረጃ አይታወቅም።',
    pickupInstructions: 'ምሳሌ ብቻ፦ በምሳሌው መቀበያ ጠረጴዛ ኮድዎን ያሳዩ፤ ለእያንዳንዱ ድርሻ አንድ የታሸገ አትክልት ወጥ እና ለብቻ የተጠቀለለ እንጀራ ይውሰዱ። እውነተኛ መውሰድ አገልግሎት የለም።'
  }),
  sample({
    id: 'sample-glazed-donuts', name: 'Glazed donuts', availablePortions: 6,
    description: 'Sample baked yeast donuts with a powdered-sugar and milk glaze. This example uses eggs, milk and butter in the dough.',
    portionSize: 'Two medium glazed donuts in one paper box.',
    ingredients: ['Wheat flour', 'Milk', 'Egg', 'Butter (milk)', 'Sugar', 'Yeast', 'Vanilla extract', 'Salt', 'Glaze (powdered sugar and milk)'],
    allergens: 'This sample recipe contains wheat, milk and egg. Cross-contact information is unknown.',
    pickupInstructions: 'Example only: show your pickup code at the fictional welcome table and collect one closed box containing two donuts per portion. No real pickup is offered.'
  }, {
    name: 'በስኳር ሽፋን የተሸፈኑ ዶናቶች',
    description: 'እነዚህ የምሳሌ ዶናቶች በእርሾ ተዘጋጅተው በምድጃ ይጋገራሉ፤ የዱቄት ስኳርና የወተት ሽፋን አላቸው። በሊጡ ውስጥ እንቁላል፣ ወተትና ቅቤ ይጠቀማሉ።',
    portionSize: 'በአንድ የወረቀት ሳጥን ሁለት መካከለኛ ዶናቶች።',
    ingredients: ['የስንዴ ዱቄት', 'ወተት', 'እንቁላል', 'ቅቤ (ወተት)', 'ስኳር', 'እርሾ', 'ቫኒላ', 'ጨው', 'ሽፋን (የዱቄት ስኳር እና ወተት)'],
    allergens: 'ይህ የምሳሌ አዘገጃጀት ስንዴ፣ ወተት እና እንቁላል ይዟል። ከሌሎች ምግቦች ጋር የመነካካት መረጃ አይታወቅም።',
    pickupInstructions: 'ምሳሌ ብቻ፦ በምሳሌው መቀበያ ጠረጴዛ ኮድዎን ያሳዩ፤ ለእያንዳንዱ ድርሻ ሁለት ዶናቶች ያሉበትን የተዘጋ ሳጥን ይውሰዱ። እውነተኛ መውሰድ አገልግሎት የለም።'
  }),
  sample({
    id: 'sample-fruit-cups', name: 'Fresh fruit cups', availablePortions: 6,
    description: 'Sample fresh apple, orange and grape cups with lemon juice. This recipe has no yogurt, nuts, granola or added toppings.',
    portionSize: 'One sealed 12 oz cup containing about 1½ cups of cut fruit.',
    ingredients: ['Apple', 'Orange', 'Seedless grapes', 'Lemon juice'],
    allergens: 'None of the major food allergens is an ingredient in this specified sample recipe. Cross-contact information is unknown; this is not a guarantee for any real food.',
    pickupInstructions: 'Example only: show your pickup code at the fictional welcome table and collect one sealed fruit cup per portion. No real pickup is offered.'
  }, {
    name: 'ትኩስ የፍራፍሬ ኩባያዎች',
    description: 'የምሳሌ የፖም፣ የብርቱካንና የወይን ፍሬ ኩባያዎች በሎሚ ጭማቂ ይዘጋጃሉ። እርጎ፣ ለውዝ፣ ግራኖላ ወይም ሌላ ተጨማሪ ሽፋን አይዟሉም።',
    portionSize: 'አንድ የታሸገ 12 አውንስ ኩባያ፤ ወደ አንድና ግማሽ ኩባያ የተቆረጠ ፍራፍሬ ይዟል።',
    ingredients: ['ፖም', 'ብርቱካን', 'ያለ ዘር የወይን ፍሬ', 'የሎሚ ጭማቂ'],
    allergens: 'በዚህ የተገለጸ የምሳሌ አዘገጃጀት ውስጥ ዋና የምግብ አለርጂ አስከታይ ንጥረ ነገሮች አይካተቱም። ከሌሎች ምግቦች ጋር የመነካካት መረጃ አይታወቅም፤ ይህ ለእውነተኛ ምግብ ዋስትና አይደለም።',
    pickupInstructions: 'ምሳሌ ብቻ፦ በምሳሌው መቀበያ ጠረጴዛ ኮድዎን ያሳዩ፤ ለእያንዳንዱ ድርሻ አንድ የታሸገ የፍራፍሬ ኩባያ ይውሰዱ። እውነተኛ መውሰድ አገልግሎት የለም።'
  })
];
module.exports = { sampleFoods };
