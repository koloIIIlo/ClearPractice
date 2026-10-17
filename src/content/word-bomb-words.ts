/**
 * Word bomb (roadmap 10.4, appendix C.2): 200 everyday concrete nouns with
 * their plurals, so a word counts whichever form you say. IDs are
 * `wb-<singular>` and never change.
 */
export type BombWord = { id: string; singular: string; plural: string };

const PAIRS: readonly (readonly [string, string])[] = [
  ["umbrella", "umbrellas"], ["bicycle", "bicycles"], ["lighthouse", "lighthouses"], ["sandwich", "sandwiches"], ["ladder", "ladders"],
  ["passport", "passports"], ["keyboard", "keyboards"], ["candle", "candles"], ["suitcase", "suitcases"], ["apple", "apples"],
  ["banana", "bananas"], ["bottle", "bottles"], ["bucket", "buckets"], ["button", "buttons"], ["camera", "cameras"],
  ["carpet", "carpets"], ["castle", "castles"], ["chair", "chairs"], ["clock", "clocks"], ["cloud", "clouds"],
  ["coat", "coats"], ["compass", "compasses"], ["cookie", "cookies"], ["cushion", "cushions"], ["desk", "desks"],
  ["diamond", "diamonds"], ["dictionary", "dictionaries"], ["dolphin", "dolphins"], ["door", "doors"], ["dragon", "dragons"],
  ["drum", "drums"], ["eagle", "eagles"], ["envelope", "envelopes"], ["feather", "feathers"], ["fence", "fences"],
  ["ferry", "ferries"], ["flag", "flags"], ["flower", "flowers"], ["fork", "forks"], ["fountain", "fountains"],
  ["garden", "gardens"], ["giraffe", "giraffes"], ["glove", "gloves"], ["guitar", "guitars"], ["hammer", "hammers"],
  ["hat", "hats"], ["helmet", "helmets"], ["island", "islands"], ["jacket", "jackets"], ["jar", "jars"],
  ["kettle", "kettles"], ["key", "keys"], ["knife", "knives"], ["lamp", "lamps"], ["leaf", "leaves"],
  ["lemon", "lemons"], ["letter", "letters"], ["library", "libraries"], ["lion", "lions"], ["lorry", "lorries"],
  ["magnet", "magnets"], ["map", "maps"], ["mirror", "mirrors"], ["monkey", "monkeys"], ["motorbike", "motorbikes"],
  ["mountain", "mountains"], ["mushroom", "mushrooms"], ["napkin", "napkins"], ["necklace", "necklaces"], ["needle", "needles"],
  ["notebook", "notebooks"], ["onion", "onions"], ["orange", "oranges"], ["owl", "owls"], ["paintbrush", "paintbrushes"],
  ["parrot", "parrots"], ["pencil", "pencils"], ["penguin", "penguins"], ["piano", "pianos"], ["pillow", "pillows"],
  ["pineapple", "pineapples"], ["pizza", "pizzas"], ["planet", "planets"], ["plate", "plates"], ["pocket", "pockets"],
  ["postcard", "postcards"], ["potato", "potatoes"], ["pyramid", "pyramids"], ["rabbit", "rabbits"], ["radio", "radios"],
  ["river", "rivers"], ["robot", "robots"], ["rocket", "rockets"], ["rope", "ropes"], ["sailboat", "sailboats"],
  ["saucepan", "saucepans"], ["scarf", "scarves"], ["scooter", "scooters"], ["shell", "shells"], ["ship", "ships"],
  ["shoe", "shoes"], ["sofa", "sofas"], ["spoon", "spoons"], ["staircase", "staircases"], ["stamp", "stamps"],
  ["statue", "statues"], ["strawberry", "strawberries"], ["submarine", "submarines"], ["sunflower", "sunflowers"], ["swing", "swings"],
  ["table", "tables"], ["teapot", "teapots"], ["telescope", "telescopes"], ["tent", "tents"], ["ticket", "tickets"],
  ["tiger", "tigers"], ["toaster", "toasters"], ["tomato", "tomatoes"], ["torch", "torches"], ["tower", "towers"],
  ["tractor", "tractors"], ["train", "trains"], ["tree", "trees"], ["trumpet", "trumpets"], ["tunnel", "tunnels"],
  ["turtle", "turtles"], ["violin", "violins"], ["wallet", "wallets"], ["watch", "watches"], ["waterfall", "waterfalls"],
  ["wheel", "wheels"], ["whistle", "whistles"], ["window", "windows"], ["zebra", "zebras"], ["anchor", "anchors"],
  ["backpack", "backpacks"], ["balloon", "balloons"], ["basket", "baskets"], ["battery", "batteries"], ["bench", "benches"],
  ["blanket", "blankets"], ["bridge", "bridges"], ["brush", "brushes"], ["cabin", "cabins"], ["calendar", "calendars"],
  ["canoe", "canoes"], ["carrot", "carrots"], ["cave", "caves"], ["chimney", "chimneys"], ["coin", "coins"],
  ["cottage", "cottages"], ["crown", "crowns"], ["cup", "cups"], ["elephant", "elephants"],
  ["fireplace", "fireplaces"], ["fridge", "fridges"], ["frog", "frogs"], ["gate", "gates"],
  ["harbour", "harbours"], ["horse", "horses"], ["kangaroo", "kangaroos"],
  ["lantern", "lanterns"], ["lizard", "lizards"], ["marble", "marbles"], ["medal", "medals"],
  ["microphone", "microphones"], ["mug", "mugs"], ["museum", "museums"], ["nest", "nests"], ["octopus", "octopuses"],
  ["oven", "ovens"], ["padlock", "padlocks"], ["painting", "paintings"], ["peach", "peaches"],
  ["pear", "pears"], ["pebble", "pebbles"], ["pen", "pens"], ["pigeon", "pigeons"], ["puddle", "puddles"],
  ["puppet", "puppets"], ["raincoat", "raincoats"], ["ring", "rings"], ["roof", "roofs"],
  ["seagull", "seagulls"], ["shark", "sharks"], ["snail", "snails"], ["sock", "socks"],
  ["spider", "spiders"], ["squirrel", "squirrels"], ["stool", "stools"], ["swan", "swans"], ["sword", "swords"],
  ["taxi", "taxis"], ["tortoise", "tortoises"], ["toothbrush", "toothbrushes"], ["towel", "towels"],
  ["trophy", "trophies"], ["tyre", "tyres"], ["vase", "vases"], ["wardrobe", "wardrobes"],
];

export const WORD_BOMB_WORDS: readonly BombWord[] = PAIRS.map(([singular, plural]) => ({ id: `wb-${singular}`, singular, plural }));
