-- Migration to add HaloAgency client (V3 - Single Insert)
-- Client ID: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d

INSERT INTO public.clients (client_id, name, domain, user_id)
VALUES (
    '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    'HaloAgency',
    'haloagency.cz',
    NULL
);
