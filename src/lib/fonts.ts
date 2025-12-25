export const GOOGLE_FONTS = [
    { name: 'Inter', family: 'Inter', category: 'Sans Serif' },
    { name: 'Roboto', family: 'Roboto', category: 'Sans Serif' },
    { name: 'Oswald', family: 'Oswald', category: 'Condensed' },
    { name: 'Merriweather', family: 'Merriweather', category: 'Serif' },
    { name: 'Permanent Marker', family: 'Permanent Marker', category: 'Handwriting' },
    { name: 'Lobster', family: 'Lobster', category: 'Display' },
];

export const getGoogleFontUrl = (fontFamily: string) => {
    return `https://fonts.googleapis.com/css2?family=${fontFamily.replace(/\s+/g, '+')}:wght@400;600;800&display=swap`;
};
