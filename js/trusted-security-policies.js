if (window.trustedTypes && window.trustedTypes.createPolicy) {
	
	const allowedExact = [
		'https://cdn.prod.website-files.com/696c49e15cab3396438e3aac%2F689e5ba67671442434f3ca35%2F699ab17e234049b5959f07ab%2Fjsonld_orgwebsite-1.0.1.js',
		'https://cdn.jsdelivr.net/npm/@finsweet/attributes-cmsfilter@1/cmsfilter.js',
		'https://cdn.jsdelivr.net/npm/@finsweet/attributes-cmsselect@1/cmsselect.js'
	];
	
    window.ttPolicy = window.trustedTypes.createPolicy('default', {
        createHTML: (string) => DOMPurify.sanitize(string, {
            RETURN_TRUSTED_TYPE: true,

            // Allow data-* attributes (VERY important for CMS/filter libs)
            ALLOW_DATA_ATTR: true,

            // Allow common attributes often used by libraries
            ADD_ATTR: ['class', 'style', 'id'],

            // Optional: allow specific tags if your CMS uses them
            ADD_TAGS: ['iframe'], // remove if not needed

            // Keep safe URI attributes intact
            ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data:image\/))/i
        }),

        // ⚠️ These are still unsafe — better to restrict if possible
		
		/*
		createScriptURL: (input) => {
			try {
				const url = new URL(input);

				// ✅ exact file you want to allow
				const allowedExact = [
					'https://cdn.prod.website-files.com/696c49e15cab3396438e3aac%2F689e5ba67671442434f3ca35%2F699ab17e234049b5959f07ab%2Fjsonld_orgwebsite-1.0.1.js',
					'https://cdn.jsdelivr.net/npm/@finsweet/attributes-cmsfilter@1/cmsfilter.js'
				];

				// ✅ allowed hosts (optional, for other libs)
				const allowedHosts = [
					'www.googletagmanager.com',
					'www.google.com',
					'www.gstatic.com',

				];

				// ✔ allow same-origin
				if (url.origin === window.location.origin) {
					return input;
				}

				// ✔ allow exact match ONLY
				if (allowedExact.includes(input)) {
					return input;
				}

				// ✔ allow known safe hosts (optional)
				if (allowedHosts.includes(url.hostname)) {
					return input;
				}

			} catch (e) {}

			throw new TypeError('Untrusted script URL: ' + input);
		},
		*/
		
		
		createScriptURL: (input) => {
            try {
                const url = new URL(input);
                const normalized = url.href;

                

                const allowedHosts = [
                    'www.googletagmanager.com',
                    'www.google.com',
                    'www.gstatic.com'
                ];

                if (url.origin === window.location.origin) {
                    return input;
                }

                if (allowedExact.some(a => new URL(a).href === normalized)) {
                    return input;
                }

                if (allowedHosts.includes(url.hostname)) {
                    return input;
                }

            } catch (e) {}

            throw new TypeError('Untrusted script URL: ' + input);
        },

        createScript: (string) => {
            // ⚠️ compromise: allow known safe patterns only
            if (string.includes('googletagmanager') || string.includes('recaptcha')) {
                return string;
            }
			
			try{
				let resultJSON = JSON.parse(string);
				return string;
			}
			catch(exTestJson)
			{
			}
		   

            throw new TypeError('Blocked inline script');
        }
    });
}


