"""What customers talk about: a transparent keyword lexicon for appliance reviews.

Each theme is a regular expression applied to the lower-cased review title + text. A review "mentions" a theme
if the expression matches. Deliberately simple and inspectable: an executive can read the words, and so can
an analyst who disagrees with them.
"""
THEMES = [
    ("fit", "Fit & compatibility",
     r"\bfits?\b|\bfit(ted|ting)?\b|compatib|wrong (size|part|model)|model number|exact (fit|match)|doesn'?t fit|didn'?t fit|too (big|small|large|short|long)"),
    ("leak", "Leaks",
     r"\bleak|dripping (water|from|out)|drips? (water|from|out|everywhere)|water everywhere|flood|puddle"),
    ("durability", "Durability & reliability",
     r"\bbroke|\bbroken|cracked|crack\b|stopped working|quit working|died\b|\bdoa\b|lasted|last(s|ed)? (long|only|for|a)|durable|flimsy|fell apart|wore out|defective|malfunction|within (a )?(week|month|day)"),
    ("noise", "Noise",
     r"\bnois|\bloud|\bquiet|rattl|\bhum(s|ming)?\b|squeak|vibrat|grind"),
    ("install", "Installation & instructions",
     r"\binstall|instruction|easy to (put|set|hook|attach|replace|swap)|hard to (put|set|attach)|\bsetup\b|set up|hook(ed)? up|screw(s|ed)?\b|\bbracket"),
    ("water", "Water, ice & taste",
     r"\btaste|\btastes|\bodor|\bsmell|clean water|\bice\b|cloudy|flavor|chlorine|filter(s|ed|ing)? (the )?(water|ice)|drinking water|water (quality|tastes?)"),
    ("performance", "Performance",
     r"works? (great|well|perfect|fine|as)|working (great|well|perfect|fine)|\bcools?\b|\bcold\b|freez|\bheats?\b|\bheating|dries|dryer works|powerful|efficien|performance|does the job|clean(s|ed)? (well|great)"),
    ("value", "Value for money",
     r"\bprice|\bcheap|expensive|\bvalue\b|worth|overpriced|bargain|\bmoney\b|\bcost|affordable|\bdeal\b"),
    ("delivery", "Delivery & packaging",
     r"\barrived|\bshipping|\bshipped|packag|\bbox\b|\blate\b|damaged|delivery|delivered|\bquick(ly)? (ship|deliver)|on time"),
    ("service", "Service & returns",
     r"\breturn|refund|\bseller\b|customer service|warranty|replacement (sent|was|came)|\bsupport\b|contact(ed)? (the )?(seller|company|manufacturer)|\bexchange"),
    ("genuine", "Genuine vs fake",
     r"\boem\b|\bgenuine|\boriginal|knock-?off|counterfeit|\bfake|authentic|generic|off-?brand|aftermarket"),
    ("ease", "Ease of use & cleaning",
     r"easy to (use|clean|operate|read|open|fill|remove)|simple to|user.?friendly|hard to (use|clean|open|read|fill|remove)|difficult to|\bcleaning|dishwasher safe"),
]
THEME_KEYS = [t[0] for t in THEMES]
THEME_LABELS = [t[1] for t in THEMES]
